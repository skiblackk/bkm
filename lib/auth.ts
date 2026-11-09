import { permissionCatalog, grantsSatisfy, ADMIN_BYPASS_EXCLUSIONS, type PermissionId, type ProvisionedUser, type UserRole } from './access-control';
import { validatePermissionKeys, getEffectiveAccess, PermissionError } from './permissions';
import { createSupabaseServerClient } from './supabase/server';

export interface DemoSession { account: string; name: string; role: string; initials: string; isAdmin: boolean; staffId: string | null; permissions: PermissionId[]; email?: string; }
const fullAccess: PermissionId[] = permissionCatalog.map((item) => item.id);
/**
 * Effective-permission check. Administrators hold every catalogue key except
 * the restricted set (payroll, confidential documents) which must be granted
 * explicitly; everyone else is checked against their evaluated grants with
 * legacy-key equivalence.
 */
export function hasPermission(session: DemoSession, permission: PermissionId): boolean {
  if (session.isAdmin) return !ADMIN_BYPASS_EXCLUSIONS.includes(permission);
  return grantsSatisfy(new Set(session.permissions), permission);
}

export async function requirePermission(permission: PermissionId) {
  const session = await getDemoSession();
  if (!session) throw new PermissionError('Sign in is required.', 401);
  if (!hasPermission(session, permission)) throw new PermissionError(`Permission required: ${permission}.`, 403);
  return session;
}
const AUTO_APPROVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Approval gate for sign-in. Pending accounts are refused until an
 * administrator approves them; four hours after sign-up they are approved
 * automatically at the next sign-in attempt.
 */
export async function ensureAccountApproved(userId: string): Promise<{ ok: boolean; message?: string }> {
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
      const access = await getEffectiveAccess(user.id);
      if (!access || !access.isActive) return null;
      const { data: profile } = await supabase.from('profiles').select('full_name, email, initials').eq('id', user.id).maybeSingle();
      return {
        account: user.id,
        name: profile?.full_name ?? user.email ?? 'User',
        role: access.roleNames[0] ?? 'Staff',
        initials: profile?.initials ?? 'US',
        isAdmin: access.isAdmin,
        staffId: user.id,
        permissions: Array.from(access.permissions),
        email: profile?.email ?? user.email ?? undefined,
      };
    }
  }
  return null;
}
