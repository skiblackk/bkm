import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission, type DemoSession } from '@/lib/auth';
import { assertKnownPermissionKeys, validatePermissionKeys, PermissionError } from '@/lib/permissions';
import { listWorkspaceUsers, provisionUser, wipeWorkspaceData } from '@/lib/data-access';
import { addStaffMember, approveDocument, assignTask, getAccounting, getAttendance, getDocumentIntelligence, getInternalMessages, getSnapshot, removeUser, sendInternalMessage, updateAttendance, getAuditEvents, recordAudit } from '@/lib/data-access';
import { getCommunicationAlerts, getWebhookStatus } from '@/lib/communication-webhooks';
import { getIntegrationStatus } from '@/lib/integrations';
import { decideAiTriage, getAiTriageItems } from '@/lib/ai-triage';
import { businessDate } from '@/lib/business-clock';
import { getAttendanceCompliance, listAttendanceAlerts, runMissingCheckInSweep } from '@/lib/attendance-alerts';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

async function requireSession() {
  const session = await getDemoSession();
  if (!session) throw new PermissionError('Sign-in is required.', 401);
  return session;
}

/** Every action declares the permission it needs; no blanket admin gate. */
function requireActionPermission(session: DemoSession, ...permissions: string[]) {
  if (!permissions.some((permission) => hasPermission(session, permission))) {
    throw new PermissionError(`Permission required: ${permissions.join(' or ')}.`, 403);
  }
  return session;
}

/**
 * The leave queue an administrator needs to act on.
 *
 * Leave requests were being written to the database from two different forms
 * and surfaced on no administrative screen at all, so a submitted request
 * looked to the staff member like it had vanished. This is the read side of
 * that gap; the dashboard panel renders it.
 */
async function loadLeaveQueue(session: DemoSession) {
  const canSee = session.isAdmin || hasPermission(session, 'approve_leave') || hasPermission(session, 'manage_leave') || hasPermission(session, 'view_team_attendance');
  if (!canSee) return { requests: [], canDecide: false };
  const admin = createSupabaseAdminClient();
  if (!admin) return { requests: [], canDecide: false };
  const { data, error } = await admin
    .from('leave_requests')
    .select('id, user_id, leave_type, starts_on, ends_on, reason, status, decision_note, decided_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return { requests: [], canDecide: false };
  const ids = Array.from(new Set((data ?? []).map((row) => String(row.user_id))));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name, email').in('id', ids);
    for (const profile of profiles ?? []) names.set(String(profile.id), String(profile.full_name ?? profile.email ?? 'Staff member'));
  }
  return {
    requests: (data ?? []).map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      requesterName: names.get(String(row.user_id)) ?? 'Staff member',
      leaveType: String(row.leave_type),
      startsOn: String(row.starts_on),
      endsOn: String(row.ends_on),
      reason: String(row.reason ?? ''),
      status: String(row.status),
      decidedAt: row.decided_at ? String(row.decided_at) : null,
      createdAt: String(row.created_at),
    })),
    canDecide: session.isAdmin || hasPermission(session, 'approve_leave') || hasPermission(session, 'manage_leave'),
  };
}

export async function GET() {
  try {
  if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
  const session = await requireSession();
  requireActionPermission(session, 'view_user_directory', 'view_audit_logs', 'manage_workspace_settings');
  const snapshot = await getSnapshot();
  const attendance = await getAttendance();
  const todayKey = businessDate();
  const missing = attendance.records.filter((record) => record.date === todayKey && record.status === 'Not Checked In').map((record) => snapshot.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId);
  const communicationAlerts = getCommunicationAlerts();
  // Company-wide attendance compliance is only assembled for callers who are
  // allowed to see it; everyone else gets the payload without it.
  const canSeeCompliance = session.isAdmin || hasPermission(session, 'view_team_attendance') || hasPermission(session, 'manage_attendance');
  const compliance = canSeeCompliance ? await getAttendanceCompliance(todayKey).catch(() => null) : null;
  const leave = await loadLeaveQueue(session);
  return NextResponse.json({ leave, snapshot, attendance, missing, compliance, attendanceAlerts: canSeeCompliance ? await listAttendanceAlerts().catch(() => []) : [], accounting: await getAccounting(), document: await getDocumentIntelligence(), messages: await getInternalMessages(), webhooks: getWebhookStatus(), integrations: getIntegrationStatus(), communicationAlerts, aiTriage: getAiTriageItems(communicationAlerts), users: await listWorkspaceUsers(), audit: await getAuditEvents(), environment: { mode: 'production', today: todayKey } });
  } catch (error) {
    const status = error instanceof PermissionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The admin workspace could not be loaded.' }, { status });
  }
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
    const input = await request.json();
    const session = await requireSession();

    if (input.action === 'decide-leave') {
      if (!session.isAdmin) requireActionPermission(session, 'approve_leave', 'manage_leave');
      const admin = createSupabaseAdminClient();
      if (!admin) throw new PermissionError('Leave decisions are not available.', 503);
      const id = String(input.id ?? '');
      const decision = input.decision === 'Approved' ? 'Approved' : 'Rejected';
      const { data: row } = await admin.from('leave_requests').select('*').eq('id', id).maybeSingle();
      if (!row) throw new PermissionError('Leave request not found.', 404);
      if (row.status !== 'Pending') throw new PermissionError(`This request was already ${String(row.status).toLowerCase()}.`, 409);
      const { error } = await admin.from('leave_requests').update({
        status: decision,
        decided_by: session.staffId ?? session.account,
        decision_note: String(input.note ?? '').slice(0, 500),
        decided_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw new PermissionError(error.message, 400);
      await recordAudit({ actorId: session.staffId ?? session.account, actorName: session.name, actorRole: session.role, action: 'leave_decision', targetType: 'LeaveRequest', targetId: id, detail: `${decision}: ${row.leave_type} ${row.starts_on} → ${row.ends_on}`, severity: 'change' }).catch(() => undefined);
      // Tell the person who asked.
      await admin.from('notifications').insert({
        recipient_id: row.user_id, category: 'leave', priority: 'normal',
        title: `Leave ${decision.toLowerCase()}`,
        body: `${row.leave_type} leave ${row.starts_on} → ${row.ends_on} was ${decision.toLowerCase()}.${input.note ? ` Note: ${String(input.note).slice(0, 200)}` : ''}`,
        link_path: '/selfservice', related_type: 'leave_request', related_id: id,
      }).then(() => undefined, () => undefined);
      return NextResponse.json({ leave: await loadLeaveQueue(session), message: `Leave ${decision.toLowerCase()}.` });
    }

    if (input.action === 'attendance') {
      if (!session.isAdmin && session.staffId !== input.staffId) requireActionPermission(session, 'manage_attendance');
      else if (!session.isAdmin) requireActionPermission(session, 'record_own_attendance');
      return NextResponse.json({ attendance: await updateAttendance(input.staffId, input.mode, input.note) });
    }

    if (input.action === 'wipe-workspace-data') {
      requireActionPermission(session, 'manage_workspace_settings');
      const result = await wipeWorkspaceData();
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'wipe_workspace_data', targetType: 'Workspace', targetId: 'workspace', detail: `Workspace reset: ${Object.values(result.cleared).reduce((sum, count) => sum + count, 0)} records cleared`, severity: 'security' }).catch(() => undefined);
      return NextResponse.json({ message: 'Workspace data cleared. Every counter now reads zero.', cleared: result.cleared });
    }

    if (input.action === 'create-user') {
      requireActionPermission(session, 'invite_users');
      const permissions = assertKnownPermissionKeys(Array.isArray(input.permissions) ? input.permissions : JSON.parse(input.permissions ?? '[]'));
      if (!input.name || !input.email || !input.role || !Array.isArray(permissions)) throw new PermissionError('Name, email, role and permissions are required.', 400);
      const created = await provisionUser({ name: input.name, email: input.email, roleTitle: input.role, permissions, isAdmin: input.role === 'System Administrator' });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'create_user', targetType: 'User', targetId: created.userId, detail: `${input.name} created as ${input.role}`, severity: 'security' });
      return NextResponse.json({ user: { account: created.userId, name: input.name, email: input.email, role: input.role, isAdmin: input.role === 'System Administrator', permissions, active: true }, tempPassword: created.tempPassword, audit: await getAuditEvents(), message: created.tempPassword ? `Account created. Temporary password: ${created.tempPassword}` : 'Account created.' });
    }

    if (input.action === 'update-permissions') {
      requireActionPermission(session, 'assign_permissions', 'revoke_permissions');
      const permissions = assertKnownPermissionKeys(Array.isArray(input.permissions) ? input.permissions : []);
        const admin = createSupabaseAdminClient();
        if (!admin) throw new PermissionError('Supabase is not configured.', 503);
        const target = String(input.account ?? '');
        const { data: existing } = await admin.from('user_permissions').select('id, permission_key').eq('user_id', target);
        const keep = new Set(permissions);
        const stale = (existing ?? []).filter((row: { id: string; permission_key: string }) => !keep.has(row.permission_key));
        if (stale.length) await admin.from('user_permissions').delete().in('id', stale.map((row: { id: string }) => row.id));
        const have = new Set((existing ?? []).map((row: { permission_key: string }) => row.permission_key));
        const added = permissions.filter((key) => !have.has(key));
        if (added.length) await admin.from('user_permissions').insert(added.map((permission_key) => ({ user_id: target, permission_key, effect: 'allow', granted_by: session.account })));
        await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'update_permissions', targetType: 'User', targetId: target, detail: `Permissions updated: ${added.length} granted, ${stale.length} revoked`, severity: 'security' });
        return NextResponse.json({ users: await listWorkspaceUsers(), audit: await getAuditEvents() });

    }

    if (input.action === 'set-permission') {
      requireActionPermission(session, 'assign_permissions', 'revoke_permissions');
      const keys = assertKnownPermissionKeys([input.permission]);
      const target = String(input.account ?? '');
      const effect = input.effect === 'deny' ? 'deny' : 'allow';
      const reason = input.reason ? String(input.reason).slice(0, 500) : null;
      const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
      const startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : null;
      if (!target || !keys.length) throw new PermissionError('A user and a catalogue permission are required.', 400);
      const admin = createSupabaseAdminClient();
      if (!admin) throw new PermissionError('Supabase is not configured.', 503);
      if (input.revoke) {
        await admin.from('user_permissions').delete().eq('user_id', target).eq('permission_key', keys[0]);
      } else {
        await admin.from('user_permissions').upsert({ user_id: target, permission_key: keys[0], effect, reason, starts_at: startsAt, expires_at: expiresAt, granted_by: session.account }, { onConflict: 'user_id,permission_key' });
      }
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: input.revoke ? 'revoke_permission' : 'grant_permission', targetType: 'User', targetId: target, detail: `${input.revoke ? 'Revoked' : `Granted (${effect}${expiresAt ? `, expires ${expiresAt}` : ''})`} ${keys[0]}${reason ? ` — ${reason}` : ''}`, severity: 'security' });
      return NextResponse.json({ users: await listWorkspaceUsers(), audit: await getAuditEvents() });
    }

    if (input.action === 'set-role') {
      requireActionPermission(session, 'assign_permissions', 'manage_roles');
      const target = String(input.account ?? '');
      const roleName = String(input.role ?? '');
      if (!target || !roleName) throw new PermissionError('A user and a role are required.', 400);
      const admin = createSupabaseAdminClient();
      if (!admin) throw new PermissionError('Supabase is not configured.', 503);
      const { data: role } = await admin.from('roles').select('id, name').eq('name', roleName).maybeSingle();
      if (!role) throw new PermissionError('Unknown role template.', 400);
      if ((role.name === 'System Administrator' || role.name === 'CEO / Managing Partner') && !session.isAdmin) throw new PermissionError('Only a platform administrator can assign administrator roles.', 403);
      await admin.from('profiles').update({ role_id: role.id, updated_at: new Date().toISOString() }).eq('id', target);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'set_role', targetType: 'User', targetId: target, detail: `Role set to ${role.name}`, severity: 'security' });
      return NextResponse.json({ users: await listWorkspaceUsers(), audit: await getAuditEvents() });
    }

    if (input.action === 'suspend-user' || input.action === 'reactivate-user') {
      requireActionPermission(session, 'suspend_users');
      const target = String(input.account ?? '');
      if (!target) throw new PermissionError('A user is required.', 400);
      if (target === session.account) throw new PermissionError('You cannot suspend your own account.', 400);
      const admin = createSupabaseAdminClient();
      if (!admin) throw new PermissionError('Supabase is not configured.', 503);
      if (input.action === 'suspend-user') {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true).eq('active', true);
        const { data: targetRow } = await admin.from('profiles').select('is_admin, active').eq('id', target).maybeSingle();
        if (targetRow?.is_admin && (count ?? 0) <= 1) throw new PermissionError('The last active administrator cannot be suspended. Transfer ownership first.', 400);
      }
      const active = input.action === 'reactivate-user';
      await admin.from('profiles').update({ active, updated_at: new Date().toISOString() }).eq('id', target);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: input.action, targetType: 'User', targetId: target, detail: active ? 'Account reactivated' : 'Account suspended', severity: 'security' });
      return NextResponse.json({ users: await listWorkspaceUsers(), audit: await getAuditEvents(), message: active ? 'Account reactivated.' : 'Account suspended. The user can no longer sign in or use existing sessions.' });
    }

    if (input.action === 'audit') {
      requireActionPermission(session, 'view_audit_logs');
      return NextResponse.json({ audit: await getAuditEvents({ actorId: input.actorId, action: input.filterAction }) });
    }
    if (input.action === 'run-attendance-sweep') {
      requireActionPermission(session, 'manage_attendance');
      const result = await runMissingCheckInSweep();
      return NextResponse.json({ message: `Attendance sweep complete: ${result.created} alert(s) created, ${result.skipped} already sent.`, result });
    }

    if (input.action === 'approve-document') {
      requireActionPermission(session, 'approve_documents');
      return NextResponse.json({ document: await approveDocument() });
    }
    if (input.action === 'approve-ai-triage' || input.action === 'reject-ai-triage') {
      requireActionPermission(session, 'execute_approved_ai_actions');
      if (!input.triageId) throw new PermissionError('A triage item is required.', 400);
      const status = input.action === 'approve-ai-triage' ? 'Approved' : 'Rejected';
      decideAiTriage(input.triageId, status, input.suggestedReply);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: input.action, targetType: 'Communication', targetId: input.triageId, detail: `AI triage draft ${status.toLowerCase()} by ${session.name}`, severity: status === 'Approved' ? 'change' : 'info' });
      return NextResponse.json({ aiTriage: getAiTriageItems(getCommunicationAlerts()), audit: await getAuditEvents() });
    }
    if (input.action === 'remove-user') {
      requireActionPermission(session, 'suspend_users');
      return NextResponse.json({ snapshot: await removeUser(input.staffId) });
    }
    if (input.action === 'assign-task') {
      requireActionPermission(session, 'assign_tasks');
      return NextResponse.json({ snapshot: await assignTask(input.taskId, input.staffId) });
    }
    if (input.action === 'broadcast' || input.action === 'message-user') {
      requireActionPermission(session, ...(input.action === 'broadcast' ? ['post_announcements'] : ['send_messages']));
      const snapshot = await getSnapshot();
      const recipientId = input.action === 'broadcast' ? 'all' : input.recipientId;
      const recipientName = recipientId === 'all' ? 'All users' : snapshot.staff.find((member) => member.id === recipientId)?.name;
      if (!recipientName) throw new PermissionError('Choose a valid recipient.', 400);
      return NextResponse.json({ message: await sendInternalMessage({ senderId: session.account, senderName: session.name, recipientId, recipientName, body: input.body, kind: recipientId === 'all' ? 'broadcast' : 'direct' }) });
    }
    return NextResponse.json({ error: 'Unsupported admin action.' }, { status: 400 });
  } catch (error) {
    const status = error instanceof PermissionError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Admin action failed.' }, { status });
  }
}
