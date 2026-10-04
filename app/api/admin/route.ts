import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { approveDocument, assignTask, getAccounting, getAttendance, getDocumentIntelligence, getInternalMessages, getSnapshot, removeUser, sendInternalMessage, updateAttendance } from '@/lib/repository';

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
  const missing = attendance.records.filter((record) => record.date === '2026-10-01' && record.status === 'Not Checked In').map((record) => snapshot.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId);
  return NextResponse.json({ snapshot, attendance, missing, accounting: getAccounting(), document: getDocumentIntelligence(), messages: getInternalMessages() });
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
    if (input.action === 'approve-document') return NextResponse.json({ document: approveDocument() });
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
