import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/lib/data-access';
import { notifyLeaveSubmitted } from '@/lib/leave-notifications';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const admin = db();
  // An administrator who does not hold one of the leave keys still had no way
  // to see the queue. Session.isAdmin is the same flag the SQL helper uses, so
  // the API and the row-level policy now agree on who may look.
  const seesAll = session.isAdmin || hasPermission(session, 'approve_leave') || hasPermission(session, 'manage_leave') || hasPermission(session, 'view_team_attendance');
  const canDecide = session.isAdmin || hasPermission(session, 'approve_leave') || hasPermission(session, 'manage_leave');
  const query = admin.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(100);
  const { data, error } = await (seesAll ? query : query.eq('user_id', session.account));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Name the requester so the admin queue reads like a queue, not a list of uuids.
  const rows = data ?? [];
  const requesterIds = Array.from(new Set(rows.map((row) => String(row.user_id))));
  const names = new Map<string, string>();
  if (requesterIds.length) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name, email').in('id', requesterIds);
    for (const profile of profiles ?? []) names.set(String(profile.id), String(profile.full_name ?? profile.email ?? 'Staff member'));
  }
  return NextResponse.json({
    requests: rows.map((row) => ({ ...row, requesterName: names.get(String(row.user_id)) ?? 'Staff member' })),
    canDecide,
  });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
 
  try {
    const input = await request.json();
    const admin = db();
    if (input.action === 'request') {
      if (!hasPermission(session, 'request_leave')) return NextResponse.json({ error: 'Permission required: request_leave.' }, { status: 403 });
      const leaveType = String(input.leaveType ?? 'annual').slice(0, 50);
      const startsOn = String(input.startsOn ?? '');
      const endsOn = String(input.endsOn ?? '');
      const reason = String(input.reason ?? '').slice(0, 1000);
      if (!startsOn || !endsOn || endsOn < startsOn) return NextResponse.json({ error: 'A valid date range is required.' }, { status: 400 });
      const { data: created, error } = await admin.from('leave_requests').insert({ user_id: session.account, leave_type: leaveType, starts_on: startsOn, ends_on: endsOn, reason }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'leave_requested', targetType: 'LeaveRequest', targetId: created.id, detail: `${leaveType} leave ${startsOn} → ${endsOn}`, severity: 'info' });
      // A submitted request that nobody is told about is the second half of the
      // reported bug: it was written, but no administrator was ever notified.
      await notifyLeaveSubmitted({ requesterId: session.account, requesterName: session.name, leaveType, startsOn, endsOn, requestId: created.id });
      return NextResponse.json({ request: created }, { status: 201 });
    }
    if (input.action === 'decide') {
      const decision = input.decision === 'Approved' ? 'Approved' : 'Rejected';
      if (!hasPermission(session, 'approve_leave') && !hasPermission(session, 'manage_leave') && !session.isAdmin) return NextResponse.json({ error: 'Permission required: approve_leave.' }, { status: 403 });
      const id = String(input.id ?? '');
      const { data: row } = await admin.from('leave_requests').select('*').eq('id', id).maybeSingle();
      if (!row) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 });
      // Deciding twice must not silently overwrite a recorded decision.
      if (row.status !== 'Pending') return NextResponse.json({ error: `This request was already ${String(row.status).toLowerCase()}.` }, { status: 409 });
      const { error } = await admin.from('leave_requests').update({ status: decision, decided_by: session.account, decision_note: String(input.note ?? '').slice(0, 500), decided_at: new Date().toISOString() }).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'leave_decision', targetType: 'LeaveRequest', targetId: id, detail: `${decision}: ${row.leave_type} ${row.starts_on} → ${row.ends_on}`, severity: 'change' });
      await admin.from('notifications').insert({ recipient_id: row.user_id, category: 'leave', priority: 'normal', title: `Leave ${decision.toLowerCase()}`, body: `${row.leave_type} leave ${row.starts_on} → ${row.ends_on} was ${decision.toLowerCase()}.`, link_path: '/workspace', related_type: 'leave_request', related_id: id }).then(() => undefined, () => undefined);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported leave action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Leave action failed.' }, { status: 400 });
  }
}
