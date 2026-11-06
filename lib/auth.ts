import { cookies } from 'next/headers';
import { permissionCatalog, type PermissionId, type ProvisionedUser, type UserRole } from './access-control';
import { isProductionDataMode } from './runtime-mode';
import { createSupabaseServerClient } from './supabase/server';

export interface DemoSession { account: string; name: string; role: string; initials: string; isAdmin: boolean; staffId: string | null; permissions: PermissionId[]; email?: string; }
const fullAccess: PermissionId[] = ['view_dashboard', 'manage_clients', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'];
declare global { var __bkmDemoAccounts: Record<string, DemoSession> | undefined; }
const demoAccounts: Record<string, DemoSession> = globalThis.__bkmDemoAccounts ?? (globalThis.__bkmDemoAccounts = {
  benjamin: { account: 'benjamin', name: 'Benjamin Mutua', role: 'System Administrator', initials: 'BM', isAdmin: true, staffId: null, permissions: fullAccess },
  david: { account: 'david', name: 'David Kamau', role: 'Audit Manager', initials: 'DK', isAdmin: false, staffId: 'staff-david', permissions: ['view_dashboard', 'manage_clients', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'] },
  mary: { account: 'mary', name: 'Mary Wanjiku', role: 'Senior Auditor', initials: 'MW', isAdmin: false, staffId: 'staff-mary', permissions: ['view_dashboard', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'] },
  faith: { account: 'faith', name: 'Faith Njeri', role: 'Audit Associate', initials: 'FN', isAdmin: false, staffId: 'staff-faith', permissions: ['view_dashboard', 'manage_tasks', 'use_assistant', 'send_messages', 'manage_documents'] },
  brian: { account: 'brian', name: 'Brian Otieno', role: 'Audit Associate', initials: 'BO', isAdmin: false, staffId: 'staff-brian', permissions: ['view_dashboard', 'manage_tasks', 'use_assistant', 'send_messages', 'manage_documents'] },
});

export type DemoAccount = string;
export function getDemoAccount(account: string | undefined): DemoSession | null { return isProductionDataMode ? null : account && demoAccounts[account] ? demoAccounts[account] : null; }
export function listDemoAccounts() { return isProductionDataMode ? [] : Object.values(demoAccounts).map((account) => ({ ...account, permissions: [...account.permissions] })); }
export function hasPermission(session: DemoSession, permission: PermissionId) { return session.isAdmin || session.permissions.includes(permission); }
export function updateDemoUserPermissions(account: string, permissions: PermissionId[]) {
  const user = demoAccounts[account];
  if (!user || user.isAdmin) throw new Error('Only non-administrator user permissions can be changed.');
  const allowed = new Set(permissionCatalog.map((item) => item.id));
  const normalized = Array.from(new Set(permissions)).filter((permission): permission is PermissionId => allowed.has(permission));
  user.permissions = normalized;
  return { ...user, permissions: [...user.permissions] };
}
export async function requirePermission(permission: PermissionId) {
  const session = await getDemoSession();
  if (!session) throw new Error('Sign in is required.');
  if (!hasPermission(session, permission)) throw new Error(`Permission required: ${permission}.`);
  return session;
}
export function provisionDemoUser(input: { name: string; email: string; role: UserRole; permissions: PermissionId[] }): DemoSession {
  if (isProductionDataMode) throw new Error('Demo user provisioning is disabled in production. Use Supabase Auth and an administrator-approved profile workflow.');
  const account = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || `user.${Date.now()}`;
  const unique = demoAccounts[account] ? `${account}.${Date.now().toString().slice(-4)}` : account;
  const staffId = `staff-${unique.replace(/\./g, '-')}`;
  const allowed = new Set(permissionCatalog.map((item) => item.id));
  const permissions = Array.from(new Set(input.permissions)).filter((permission): permission is PermissionId => allowed.has(permission));
  const user: ProvisionedUser = { account: unique, name: input.name.trim(), email: input.email.trim(), role: input.role, initials: input.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(), isAdmin: false, staffId, permissions, active: true };
  demoAccounts[unique] = user;
  return user;
}
const AUTO_APPROVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Approval gate for sign-in. Pending accounts are refused until an
 * administrator approves them; four hours after sign-up they are approved
 * automatically at the next sign-in attempt.
 */
export async function ensureAccountApproved(userId: string): Promise<{ ok: boolean; message?: string }> {
  if (!isProductionDataMode) return { ok: true };
  const { createSupabaseAdminClient } = await import('./supabase/admin');
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: 'Supabase is not configured.' };
  const { data: profile } = await admin.from('profiles').select('approval_status, created_at').eq('id', userId).maybeSingle();
  if (!profile) return { ok: false, message: 'Your account is authenticated but has no active BKM profile. Ask an administrator to provision access.' };
  if (profile.approval_status === 'approved') return { ok: true };
  if (profile.approval_status === 'rejected') return { ok: false, message: 'This account was declined by an administrator. Contact the administrator for access.' };
  const elapsed = Date.now() - new Date(profile.created_at).getTime();
  if (elapsed >= AUTO_APPROVAL_MS) {
    await admin.from('profiles').update({ approval_status: 'approved', approved_at: new Date().toISOString(), approved_by: null }).eq('id', userId);
    return { ok: true };
  }
  const remainingHours = Math.max(1, Math.ceil((AUTO_APPROVAL_MS - elapsed) / 3600000));
  return { ok: false, message: `Your account is awaiting administrator approval. Access is granted automatically about ${remainingHours} hour${remainingHours === 1 ? '' : 's'} after sign-up if not reviewed sooner.` };
}

export async function getDemoSession() {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('id, full_name, email, initials, is_admin, active, roles(name), user_permissions(permission_key)').eq('id', user.id).maybeSingle();
      if (!profile || !profile.active) return null;
      const role = Array.isArray(profile.roles) ? profile.roles[0]?.name : (profile.roles as { name?: string } | null)?.name;
      const permissionRows = Array.isArray(profile.user_permissions) ? profile.user_permissions : [];
      const permissions = profile.is_admin ? fullAccess : permissionRows.map((row: { permission_key: string }) => row.permission_key).filter((value): value is PermissionId => permissionCatalog.some((item) => item.id === value));
      return { account: user.id, name: profile.full_name, role: role ?? 'Staff', initials: profile.initials, isAdmin: Boolean(profile.is_admin), staffId: user.id, permissions, email: profile.email };
    }
    if (isProductionDataMode) return null;
  }
  const store = await cookies();
  return getDemoAccount(store.get('bkm_demo_session')?.value);
}
