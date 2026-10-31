import { NextResponse } from 'next/server';
import { getDemoSession, listDemoAccounts, provisionDemoUser } from '@/lib/auth';
import { addStaffMember, approveDocument, assignTask, getAccounting, getAttendance, getDocumentIntelligence, getInternalMessages, getSnapshot, removeUser, sendInternalMessage, updateAttendance } from '@/lib/repository';
import { getAuditEvents, recordAudit } from '@/lib/repository';
import { getCommunicationAlerts, getWebhookStatus } from '@/lib/communication-webhooks';
import { getIntegrationStatus } from '@/lib/integrations';
import { decideAiTriage, getAiTriageItems } from '@/lib/ai-triage';
import { getConfiguredDemoDate } from '@/lib/demo-config';

async function requireAdmin() {
  const session = await getDemoSession();
  if (!session?.isAdmin) throw new Error('Administrator access is required.');
  return session;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const snapshot = getSnapshot();
  const attendance = getAttendance();
  const missing = attendance.records.filter((record) => record.date === getConfiguredDemoDate() && record.status === 'Not Checked In').map((record) => snapshot.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId);
  const communicationAlerts = getCommunicationAlerts();
  return NextResponse.json({ snapshot, attendance, missing, accounting: getAccounting(), document: getDocumentIntelligence(), messages: getInternalMessages(), webhooks: getWebhookStatus(), integrations: getIntegrationStatus(), communicationAlerts, aiTriage: getAiTriageItems(communicationAlerts), users: listDemoAccounts(), audit: getAuditEvents() });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const session = await getDemoSession();
    if (!session) throw new Error('Sign-in is required.');
    if (input.action === 'attendance') {
      if (!session.isAdmin && session.staffId !== input.staffId) throw new Error('You can only update your own attendance.');
      return NextResponse.json({ attendance: updateAttendance(input.staffId, input.mode, input.note) });
    }
    const admin = await requireAdmin();
    if (input.action === 'create-user') {
      const permissions = Array.isArray(input.permissions) ? input.permissions : JSON.parse(input.permissions ?? '[]');
      if (!input.name || !input.email || !input.role || !Array.isArray(permissions)) throw new Error('Name, email, role and permissions are required.');
      const user = provisionDemoUser({ name: input.name, email: input.email, role: input.role, permissions });
      const snapshot = addStaffMember({ id: user.staffId ?? user.account, name: user.name, initials: user.initials, role: user.role, email: user.email ?? '', activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0, availability: 100, color: '#4e6982', permissions: user.permissions });
      recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: 'create_user', targetType: 'User', targetId: user.staffId ?? user.account, detail: `${user.name} created as ${user.role} with ${user.permissions.length} permissions`, severity: 'security' });
      return NextResponse.json({ user, snapshot, audit: getAuditEvents() });
    }
    if (input.action === 'update-permissions') {
      const user = listDemoAccounts().find((item) => item.account === input.account);
      if (!user || user.isAdmin) throw new Error('Only non-administrator user permissions can be changed.');
      user.permissions = input.permissions;
      recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: 'update_permissions', targetType: 'User', targetId: user.staffId ?? user.account, detail: `Permissions updated for ${user.name}`, severity: 'security' });
      return NextResponse.json({ users: listDemoAccounts(), audit: getAuditEvents() });
    }
    if (input.action === 'audit') return NextResponse.json({ audit: getAuditEvents({ actorId: input.actorId, action: input.filterAction }) });
    if (input.action === 'approve-document') return NextResponse.json({ document: approveDocument() });
    if (input.action === 'approve-ai-triage' || input.action === 'reject-ai-triage') {
      if (!input.triageId) throw new Error('A triage item is required.');
      const status = input.action === 'approve-ai-triage' ? 'Approved' : 'Rejected';
      decideAiTriage(input.triageId, status, input.suggestedReply);
      recordAudit({ actorId: admin.account, actorName: admin.name, actorRole: admin.role, action: input.action, targetType: 'Communication', targetId: input.triageId, detail: `AI triage draft ${status.toLowerCase()} by Benjamin Mutua`, severity: status === 'Approved' ? 'change' : 'info' });
      return NextResponse.json({ aiTriage: getAiTriageItems(getCommunicationAlerts()), audit: getAuditEvents() });
    }
    if (input.action === 'remove-user') return NextResponse.json({ snapshot: removeUser(input.staffId) });
    if (input.action === 'assign-task') return NextResponse.json({ snapshot: assignTask(input.taskId, input.staffId) });
    if (input.action === 'broadcast' || input.action === 'message-user') {
      const snapshot = getSnapshot();
      const recipientId = input.action === 'broadcast' ? 'all' : input.recipientId;
      const recipientName = recipientId === 'all' ? 'All users' : snapshot.staff.find((member) => member.id === recipientId)?.name;
      if (!recipientName) throw new Error('Choose a valid recipient.');
      return NextResponse.json({ message: sendInternalMessage({ senderId: admin.account, senderName: admin.name, recipientId, recipientName, body: input.body, kind: recipientId === 'all' ? 'broadcast' : 'direct' }) });
    }
    return NextResponse.json({ error: 'Unsupported admin action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Admin action failed.' }, { status: 400 }); }
}
