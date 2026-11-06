import { NextResponse } from 'next/server';
import { getDemoSession, listDemoAccounts, provisionDemoUser, updateDemoUserPermissions } from '@/lib/auth';
import { listWorkspaceUsers, provisionUser, wipeWorkspaceData } from '@/lib/data-access';
import { addStaffMember, approveDocument, assignTask, getAccounting, getAttendance, getDocumentIntelligence, getInternalMessages, getSnapshot, removeUser, sendInternalMessage, updateAttendance, getAuditEvents, recordAudit } from '@/lib/data-access';
import { getCommunicationAlerts, getWebhookStatus } from '@/lib/communication-webhooks';
import { getIntegrationStatus } from '@/lib/integrations';
import { decideAiTriage, getAiTriageItems } from '@/lib/ai-triage';
import { getConfiguredDemoDate } from '@/lib/demo-config';
import { isProductionDataMode, hasSupabaseConfiguration } from '@/lib/runtime-mode';

async function requireAdmin() {
  const session = await getDemoSession();
  if (!session?.isAdmin) throw new Error('Administrator access is required.');
  return session;
}

export async function GET() {
  if (isProductionDataMode && !hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const snapshot = await getSnapshot();
  const attendance = await getAttendance();
  const todayKey = isProductionDataMode ? new Date().toISOString().slice(0, 10) : getConfiguredDemoDate();
  const missing = attendance.records.filter((record) => record.date === todayKey && record.status === 'Not Checked In').map((record) => snapshot.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId);
  const communicationAlerts = getCommunicationAlerts();
  return NextResponse.json({ snapshot, attendance, missing, accounting: await getAccounting(), document: await getDocumentIntelligence(), messages: await getInternalMessages(), webhooks: getWebhookStatus(), integrations: getIntegrationStatus(), communicationAlerts, aiTriage: getAiTriageItems(communicationAlerts), users: await listWorkspaceUsers(), audit: await getAuditEvents(), environment: { mode: isProductionDataMode ? 'production' : 'demonstration', today: todayKey } });
}

export async function POST(request: Request) {
  try {
    if (isProductionDataMode && !hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
    const input = await request.json();
    const session = await getDemoSession();
    if (!session) throw new Error('Sign-in is required.');
    if (input.action === 'attendance') {
      if (!session.isAdmin && session.staffId !== input.staffId) throw new Error('You can only update your own attendance.');
      return NextResponse.json({ attendance: await updateAttendance(input.staffId, input.mode, input.note) });
    }
    const admin = await requireAdmin();
    if (input.action === 'wipe-workspace-data') {
      const result = await wipeWorkspaceData();
      await recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: 'wipe_workspace_data', targetType: 'Workspace', targetId: 'workspace', detail: `Administrator reset the workspace: ${Object.values(result.cleared).reduce((sum, count) => sum + count, 0)} records cleared`, severity: 'security' }).catch(() => undefined);
      return NextResponse.json({ message: 'Workspace data cleared. Every counter now reads zero.', cleared: result.cleared });
    }
    if (input.action === 'create-user') {
      const permissions = Array.isArray(input.permissions) ? input.permissions : JSON.parse(input.permissions ?? '[]');
      if (!input.name || !input.email || !input.role || !Array.isArray(permissions)) throw new Error('Name, email, role and permissions are required.');
      if (isProductionDataMode) {
        const created = await provisionUser({ name: input.name, email: input.email, roleTitle: input.role, permissions, isAdmin: input.role === 'System Administrator' });
        await recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: 'create_user', targetType: 'User', targetId: created.userId, detail: `${input.name} created as ${input.role}`, severity: 'security' });
        return NextResponse.json({ user: { account: created.userId, name: input.name, email: input.email, role: input.role, isAdmin: input.role === 'System Administrator', permissions, active: true }, tempPassword: created.tempPassword, audit: await getAuditEvents(), message: created.tempPassword ? `Account created. Temporary password: ${created.tempPassword}` : 'Account created.' });
      }
      const user = provisionDemoUser({ name: input.name, email: input.email, role: input.role, permissions });
      const snapshot = await addStaffMember({ id: user.staffId ?? user.account, name: user.name, initials: user.initials, role: user.role, email: user.email ?? '', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 100, color: '#4e6982', permissions: user.permissions });
      await recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: 'create_user', targetType: 'User', targetId: user.staffId ?? user.account, detail: `${user.name} created as ${user.role} with ${user.permissions.length} permissions`, severity: 'security' });
      return NextResponse.json({ user, snapshot, audit: await getAuditEvents() });
    }
    if (input.action === 'update-permissions') {
      const user = updateDemoUserPermissions(input.account, Array.isArray(input.permissions) ? input.permissions : []);
      await recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: 'update_permissions', targetType: 'User', targetId: user.staffId ?? user.account, detail: `Permissions updated for ${user.name}`, severity: 'security' });
      return NextResponse.json({ users: await listWorkspaceUsers(), audit: await getAuditEvents() });
    }
    if (input.action === 'audit') return NextResponse.json({ audit: await getAuditEvents({ actorId: input.actorId, action: input.filterAction }) });
    if (input.action === 'approve-document') return NextResponse.json({ document: await approveDocument() });
    if (input.action === 'approve-ai-triage' || input.action === 'reject-ai-triage') {
      if (!input.triageId) throw new Error('A triage item is required.');
      const status = input.action === 'approve-ai-triage' ? 'Approved' : 'Rejected';
      decideAiTriage(input.triageId, status, input.suggestedReply);
      await recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: input.action, targetType: 'Communication', targetId: input.triageId, detail: `AI triage draft ${status.toLowerCase()} by Benjamin Mutua`, severity: status === 'Approved' ? 'change' : 'info' });
      return NextResponse.json({ aiTriage: getAiTriageItems(getCommunicationAlerts()), audit: await getAuditEvents() });
    }
    if (input.action === 'remove-user') return NextResponse.json({ snapshot: await removeUser(input.staffId) });
    if (input.action === 'assign-task') return NextResponse.json({ snapshot: await assignTask(input.taskId, input.staffId) });
    if (input.action === 'broadcast' || input.action === 'message-user') {
      const snapshot = await getSnapshot();
      const recipientId = input.action === 'broadcast' ? 'all' : input.recipientId;
      const recipientName = recipientId === 'all' ? 'All users' : snapshot.staff.find((member) => member.id === recipientId)?.name;
      if (!recipientName) throw new Error('Choose a valid recipient.');
      return NextResponse.json({ message: await sendInternalMessage({ senderId: admin.account, senderName: admin.name, recipientId, recipientName, body: input.body, kind: recipientId === 'all' ? 'broadcast' : 'direct' }) });
    }
    return NextResponse.json({ error: 'Unsupported admin action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Admin action failed.' }, { status: 400 }); }
}
