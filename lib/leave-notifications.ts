/**
 * Leave notifications.
 *
 * A leave request that reaches the database but never reaches an administrator
 * is indistinguishable, from the staff member's side, from a request that was
 * never saved at all. Both leave entry points (`/api/leave` and
 * `/api/self-service`) use this module so the same people are told the same
 * thing no matter which form was used.
 *
 * "Administrator" here means exactly what `current_user_is_admin()` means in
 * SQL — is_admin, or one of the platform administrator roles — so the people
 * who are notified are the people who are allowed to decide.
 */
import { createSupabaseAdminClient } from './supabase/admin';
import { createNotification } from './private-messaging';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Active profiles who may decide a leave request.
 *
 * Anyone holding approve_leave or manage_leave is included even if they are not
 * a platform administrator, because they can act on the request.
 */
export async function listAdministratorIds(): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  if (!admin) return [];

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, is_admin, active, roles(name)')
    .eq('active', true)
    .limit(200);

  const adminRoles = new Set(['CEO', 'CEO / Managing Partner', 'Managing Partner', 'Administrator', 'System Administrator']);
  const ids = new Set<string>();

  for (const profile of profiles ?? []) {
    const id = String(profile.id);
    if (!UUID.test(id)) continue;
    const roleName = Array.isArray(profile.roles) ? profile.roles[0]?.name : (profile.roles as { name?: string } | null)?.name;
    if (profile.is_admin || adminRoles.has(String(roleName ?? ''))) ids.add(id);
  }

  // Anyone explicitly granted the decision keys, administrator or not.
  const { data: keyed } = await admin
    .from('user_permissions')
    .select('user_id, permission_key, effect')
    .in('permission_key', ['approve_leave', 'manage_leave'])
    .eq('effect', 'allow');
  for (const grant of keyed ?? []) {
    const id = String(grant.user_id);
    if (UUID.test(id)) ids.add(id);
  }

  return Array.from(ids);
}

/**
 * Notify every administrator about a newly submitted request.
 *
 * Returns how many notifications were written, which the API reports so the
 * test suite (and an admin debugging the path) can tell "nobody to notify" from
 * "notification failed".
 */
export async function notifyLeaveSubmitted(input: {
  requesterId: string;
  requesterName: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  requestId: string;
}): Promise<number> {
  try {
    const recipients = (await listAdministratorIds()).filter((id) => id !== input.requesterId);
    let written = 0;
    for (const recipientId of recipients) {
      const created = await createNotification({
        recipientId,
        category: 'leave',
        priority: 'high',
        title: 'Leave request awaiting your decision',
        body: `${input.requesterName} requested ${input.leaveType} leave from ${input.startsOn} to ${input.endsOn}.`,
        linkPath: '/admin?tab=people',
        relatedId: input.requestId,
        dedupeKey: `leave-request-${input.requestId}-${recipientId}`,
      });
      if (created) written += 1;
    }
    return written;
  } catch {
    return 0;
  }
}

/**
 * Notify the administrators that somebody asked for more access.
 *
 * The permission request that reaches this function used to be written to the
 * database and then forgotten: it was not pushed to the administrators, it did
 * not appear on the approvals feed the admin screen reads, and approving it did
 * not grant anything. This is the first of those three fixes.
 *
 * The same function is used by the workspace request form and by the approvals
 * API, so a request raised from either entry point is treated identically.
 */
export async function notifyAccessRequested(input: {
  requesterId: string;
  requesterName: string;
  permission: string;
  reason: string;
  requestId: string;
}): Promise<number> {
  try {
    const recipients = (await listAdministratorIds()).filter((id) => id !== input.requesterId);
    let written = 0;
    for (const recipientId of recipients) {
      const created = await createNotification({
        recipientId,
        category: 'access',
        priority: 'high',
        title: 'Permission request awaiting your decision',
        body: `${input.requesterName} asked for ${input.permission.replace(/_/g, ' ')}. Reason: ${input.reason}`,
        linkPath: '/admin?tab=access&view=requests',
        relatedId: input.requestId,
        dedupeKey: `access-request-${input.requestId}-${recipientId}`,
      });
      if (created) written += 1;
    }
    return written;
  } catch {
    return 0;
  }
}
