import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getAccounting, getAttendance, getMetrics, getSnapshot } from '@/lib/repository';
import { getConfiguredDemoDate } from '@/lib/demo-config';
export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  if (!hasPermission(session, 'view_dashboard')) return NextResponse.json({ error: 'Dashboard permission is required.' }, { status: 403 });
  const fullSnapshot = getSnapshot();
  const canManageClients = hasPermission(session, 'manage_clients');
  const canManageTasks = hasPermission(session, 'manage_tasks');
  const snapshot = {
    ...fullSnapshot,
    clients: canManageClients ? fullSnapshot.clients : [],
    engagements: canManageClients ? fullSnapshot.engagements : [],
    quotations: canManageClients ? fullSnapshot.quotations : [],
    tasks: canManageTasks ? fullSnapshot.tasks : [],
    staff: canManageTasks || session.isAdmin ? fullSnapshot.staff : [],
    activities: canManageClients || canManageTasks ? fullSnapshot.activities : [],
  };
  const attendance = getAttendance();
  const checkIn = session?.staffId ? attendance.records.find((record) => record.staffId === session.staffId && record.date === getConfiguredDemoDate()) ?? null : null;
  const accounting = hasPermission(session, 'view_finance') ? getAccounting() : null;
  return NextResponse.json({ snapshot, metrics: getMetrics(snapshot), accounting, attendance: { settings: attendance.settings, checkIn }, source: 'server-side demonstration repository' });
}
