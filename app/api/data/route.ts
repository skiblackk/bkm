import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getAccounting, getAttendance, getMetrics, getSnapshot } from '@/lib/data-access';
import { businessDate } from '@/lib/business-clock';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';

export async function GET() {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured. Set the Supabase environment variables to serve live records.' }, { status: 503 });
    const session = await getDemoSession();
    if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
    if (!hasPermission(session, 'view_dashboard')) return NextResponse.json({ error: 'Dashboard permission is required.' }, { status: 403 });
    const fullSnapshot = await getSnapshot();
    const canManageClients = hasPermission(session, 'manage_clients');
    const canManageTasks = hasPermission(session, 'manage_tasks');
    // Whitelist every collection explicitly. A spread here would re-expose
    // records that the permission checks deliberately emptied.
    const canSeeDirectory = canManageTasks || session.isAdmin || hasPermission(session, 'view_team_attendance');
    const snapshot = {
      clients: canManageClients ? fullSnapshot.clients : [],
      engagements: canManageClients ? fullSnapshot.engagements : [],
      quotations: canManageClients ? fullSnapshot.quotations : [],
      tasks: canManageTasks ? fullSnapshot.tasks : fullSnapshot.tasks.filter((task) => task.assignedTo === session.staffId),
      staff: canSeeDirectory ? fullSnapshot.staff : fullSnapshot.staff.filter((member) => member.id === session.staffId),
      activities: canManageClients || canManageTasks ? fullSnapshot.activities : [],
      reports: hasPermission(session, 'view_reports') || canManageClients ? fullSnapshot.reports : [],
      documents: hasPermission(session, 'view_documents') ? fullSnapshot.documents : [],
      environment: fullSnapshot.environment,
    };
    const attendance = await getAttendance();
    const checkIn = session?.staffId ? attendance.records.find((record) => record.staffId === session.staffId && record.date === businessDate()) ?? null : null;
    const accounting = hasPermission(session, 'view_finance') ? await getAccounting() : null;
    return NextResponse.json({ snapshot, metrics: getMetrics(snapshot), accounting, attendance: { settings: attendance.settings, checkIn }, source: 'supabase repository' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Workspace data could not be loaded.' }, { status: 500 });
  }
}
