import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/lib/data-access';
import { isProductionDataMode } from '@/lib/runtime-mode';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!isProductionDataMode) return NextResponse.json({ leaveRequests: [], accessRequests: [], activity: [] });
  const admin = db();
  const [leave, access, activity, effective] = await Promise.all([
    admin.from('leave_requests').select('id, leave_type, starts_on, ends_on, reason, status, decided_at, decision_note').eq('user_id', session.account).order('created_at', { ascending: false }).limit(20),
    admin.from('approval_requests').select('id, request_type, resource_type, reason, status, decision_note, created_at').eq('requested_by', session.account).order('created_at', { ascending: false }).limit(20),
    admin.from('activity_logs').select('id, event_type, description, created_at').eq('actor_id', session.account).order('created_at', { ascending: false }).limit(20),
    admin.from('user_permissions').select('permission_key, effect, expires_at').eq('user_id', session.account),
  ]);
  return NextResponse.json({
    leaveRequests: leave.data ?? [],
    accessRequests: access.data ?? [],
    activity: activity.data ?? [],
    myGrants: effective.data ?? [],
  });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!isProductionDataMode) return NextResponse.json({ error: 'Self-service is available in production mode.' }, { status: 400 });
  try {
    const input = await request.json();
    const admin = db();
    if (input.action === 'request-leave') {
      if (!hasPermission(session, 'request_leave')) return NextResponse.json({ error: 'Permission required: request_leave.' }, { status: 403 });
      const startsOn = String(input.startsOn ?? ''); const endsOn = String(input.endsOn ?? '');
      if (!startsOn || !endsOn || endsOn < startsOn) return NextResponse.json({ error: 'A valid date range is required.' }, { status: 400 });
      const { data: created, error } = await admin.from('leave_requests').insert({ user_id: session.account, leave_type: String(input.leaveType ?? 'annual').slice(0, 50), starts_on: startsOn, ends_on: endsOn, reason: String(input.reason ?? '').slice(0, 1000) }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'leave_requested', targetType: 'LeaveRequest', targetId: created.id, detail: `Leave requested ${startsOn} → ${endsOn}`, severity: 'info' });
      return NextResponse.json({ ok: true });
    }
    if (input.action === 'cancel-leave') {
      const { data: row } = await admin.from('leave_requests').select('*').eq('id', String(input.id ?? '')).maybeSingle();
      if (!row || row.user_id !== session.account) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
      await admin.from('leave_requests').update({ status: 'Cancelled' }).eq('id', row.id);
      return NextResponse.json({ ok: true });
    }
    if (input.action === 'request-access') {
      const permission = String(input.permission ?? '').slice(0, 120);
      const reason = String(input.reason ?? '').slice(0, 1000);
      if (!permission || !reason) return NextResponse.json({ error: 'A permission and a reason are required.' }, { status: 400 });
      const { data: created, error } = await admin.from('approval_requests').insert({
        request_type: 'access_request', resource_type: 'permission', resource_id: null,
        requested_by: session.account, reason, status: 'Pending', payload: { permission },
      }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'access_requested', targetType: 'ApprovalRequest', targetId: created.id, detail: `Access requested: ${permission} — ${reason}`, severity: 'info' });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported self-service action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Self-service action failed.' }, { status: 400 });
  }
}
