import { NextResponse } from 'next/server';
import { approveDocument, getAccounting, getAttendance, getDocumentIntelligence, getSnapshot, updateAttendance } from '@/lib/repository';

export async function GET() {
  const snapshot = getSnapshot();
  const attendance = getAttendance();
  const missing = attendance.records.filter((record) => record.date === '2026-10-01' && record.status === 'Not Checked In').map((record) => snapshot.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId);
  return NextResponse.json({ snapshot, attendance, missing, accounting: getAccounting(), document: getDocumentIntelligence() });
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    if (input.action === 'attendance') return NextResponse.json({ attendance: updateAttendance(input.staffId, input.mode, input.note) });
    if (input.action === 'approve-document') return NextResponse.json({ document: approveDocument() });
    return NextResponse.json({ error: 'Unsupported admin action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Admin action failed.' }, { status: 400 }); }
}
