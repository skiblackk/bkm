import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getAccounting, getAttendance, getMetrics, getSnapshot } from '@/lib/repository';
import { getConfiguredDemoDate } from '@/lib/demo-config';
export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  if (!hasPermission(session, 'view_dashboard')) return NextResponse.json({ error: 'Dashboard permission is required.' }, { status: 403 });
  const snapshot = getSnapshot();
  const attendance = getAttendance();
  const checkIn = session?.staffId ? attendance.records.find((record) => record.staffId === session.staffId && record.date === getConfiguredDemoDate()) ?? null : null;
  return NextResponse.json({ snapshot, metrics: getMetrics(snapshot), accounting: getAccounting(), attendance: { settings: attendance.settings, checkIn }, source: 'server-side demonstration repository' });
}
