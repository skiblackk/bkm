import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { getAccounting, getAttendance, getMetrics, getSnapshot } from '@/lib/repository';
export async function GET() {
  const session = await getDemoSession();
  const snapshot = getSnapshot();
  const attendance = getAttendance();
  const checkIn = session?.staffId ? attendance.records.find((record) => record.staffId === session.staffId && record.date === '2026-10-01') ?? null : null;
  return NextResponse.json({ snapshot, metrics: getMetrics(snapshot), accounting: getAccounting(), attendance: { settings: attendance.settings, checkIn }, source: 'server-side demonstration repository' });
}
