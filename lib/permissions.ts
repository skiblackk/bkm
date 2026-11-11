// Server-side permission engine. Evaluates a user's *effective* permissions
// exactly like the SQL helper `current_user_has_permission`:
//   1. an active explicit deny wins over everything;
//   2. platform administrators (is_admin or an administrator role) hold every
//      catalogue key except ADMIN_BYPASS_EXCLUSIONS (payroll, confidential
//      documents) which must be granted explicitly;
//   3. an active explicit allow adds a key;
//   4. role template grants (role_permissions) add keys.
// Expired or not-yet-started grants are inert. Unknown keys are rejected.
// Never trust client-supplied identity or is_admin flags — pass the user id
// resolved from the authenticated session only.

import { createSupabaseAdminClient } from './supabase/admin';
import { PERMISSION_CATALOGUE, ADMIN_BYPASS_EXCLUSIONS, RESOURCE_TYPES, ACCESS_LEVELS } from './permission-catalogue';
import { ADMIN_ROLE_NAMES, grantsSatisfy, type PermissionId } from './access-control';

export interface PermissionGrantRow {
  permissionKey: string;
  effect: 'allow' | 'deny';
  reason: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  grantedBy: string | null;
  source: 'user';
}

export interface EffectiveAccess {
  userId: string;
  isAdmin: boolean;
  isActive: boolean;
  approvalStatus: string;
  roleNames: string[];
  permissions: Set<string>;
  userGrants: PermissionGrantRow[];
  roleGrants: string[];
}

export class PermissionError extends Error {
  status: number;
  constructor(message: string, status = 403) { super(message); this.status = status; }
}

const CATALOGUE_KEYS: ReadonlySet<string> = new Set(PERMISSION_CATALOGUE.map((entry) => entry.key));

/** Reject anything not in the catalogue. Used for every admin-supplied key list. */
export function validatePermissionKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && CATALOGUE_KEYS.has(value))));
}

export function assertKnownPermissionKeys(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [];
  const unknown = list.filter((value) => typeof value !== 'string' || !CATALOGUE_KEYS.has(value as string));
  if (unknown.length) throw new PermissionError(`Unknown permission keys: ${unknown.join(', ')}`, 400);
  return validatePermissionKeys(values);
}

function grantActive(row: { starts_at?: string | null; expires_at?: string | null }): boolean {
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false;
  return true;
}

/** Load and evaluate a user's effective access from the database. */
export async function getEffectiveAccess(userId: string): Promise<EffectiveAccess | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, is_admin, active, approval_status, role_id, roles(name, is_active)')
    .eq('id', userId)
    .maybeSingle();
  if (error || !profile) return null;

  const roleRow = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  const roleName = (roleRow as { name?: string; is_active?: boolean } | null)?.name ?? null;
  const roleActive = (roleRow as { is_active?: boolean } | null)?.is_active !== false;
  const roleNames = roleName ? [roleName] : [];
  const isAdmin = Boolean(profile.is_admin) || (roleName ? (ADMIN_ROLE_NAMES as readonly string[]).includes(roleName) : false);
  const isActive = Boolean(profile.active) && profile.approval_status === 'approved';

  const [{ data: userRows }, { data: roleRows }] = await Promise.all([
    admin.from('user_permissions').select('permission_key, effect, reason, starts_at, expires_at, granted_by').eq('user_id', userId),
    roleName && roleActive
      ? admin.from('role_permissions').select('permissions(permission_key)').eq('role_id', profile.role_id)
      : Promise.resolve({ data: [] as { permissions: { permission_key: string } | { permission_key: string }[] }[] }),
  ]);

  const denies = new Set<string>();
  const allows = new Set<string>();
  const userGrants: PermissionGrantRow[] = [];
  for (const row of (userRows ?? []) as Array<{ permission_key: string; effect: string; reason: string | null; starts_at: string | null; expires_at: string | null; granted_by: string | null }>) {
    if (!CATALOGUE_KEYS.has(row.permission_key)) continue;
    const active = grantActive(row);
    userGrants.push({ permissionKey: row.permission_key, effect: row.effect === 'deny' ? 'deny' : 'allow', reason: row.reason, startsAt: row.starts_at, expiresAt: row.expires_at, grantedBy: row.granted_by, source: 'user' });
    if (!active) continue;
    if (row.effect === 'deny') denies.add(row.permission_key);
    else allows.add(row.permission_key);
  }

  const roleGrants: string[] = [];
  for (const row of (roleRows ?? []) as Array<{ permissions: { permission_key: string } | { permission_key: string }[] }>) {
    const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
    const key = (perm as { permission_key?: string } | null)?.permission_key;
    if (key && CATALOGUE_KEYS.has(key)) roleGrants.push(key);
  }

  const permissions = new Set<string>();
  if (isActive) {
    for (const key of roleGrants) permissions.add(key);
    for (const key of Array.from(allows)) permissions.add(key);
    if (isAdmin) {
      for (const entry of PERMISSION_CATALOGUE) {
        if (!ADMIN_BYPASS_EXCLUSIONS.includes(entry.key)) permissions.add(entry.key);
      }
    }
    for (const key of Array.from(denies)) permissions.delete(key);
  }

  return { userId, isAdmin, isActive, approvalStatus: String(profile.approval_status ?? 'pending'), roleNames, permissions, userGrants, roleGrants };
}

/** Check one permission against an evaluated access record (legacy-aware). */
export function accessHas(access: EffectiveAccess, permission: PermissionId): boolean {
  if (!access.isActive) return false;
  return grantsSatisfy(access.permissions, permission);
}

/** Segregation of duties: nobody approves their own restricted record. */
const RESOURCE_LEVEL_RANK: Record<string, number> = { view: 1, contribute: 2, edit: 3, manage: 4 };

/** Resource-level access check against the allowlisted resource types. */
