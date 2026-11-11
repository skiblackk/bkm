import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { recordAudit } from '@/lib/data-access';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const admin = db();
  const seesAll = hasPermission(session, 'approve_leave') || hasPermission(session, 'manage_leave') || hasPermission(session, 'view_team_attendance');
  const query = admin.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(100);
  const { data, error } = await (seesAll ? query : query.eq('user_id', session.account));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
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
      return NextResponse.json({ request: created }, { status: 201 });
    }
    if (input.action === 'decide') {
      const decision = input.decision === 'Approved' ? 'Approved' : 'Rejected';
      if (!hasPermission(session, 'approve_leave') && !hasPermission(session, 'manage_leave') && !session.isAdmin) return NextResponse.json({ error: 'Permission required: approve_leave.' }, { status: 403 });
      const id = String(input.id ?? '');
      const { data: row } = await admin.from('leave_requests').select('*').eq('id', id).maybeSingle();
      if (!row) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 });
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
