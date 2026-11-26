import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { recordAudit, updateAttendance } from '@/lib/data-access';
import { notifyLeaveSubmitted, notifyAccessRequested } from '@/lib/leave-notifications';
import { isPermissionKey } from '@/lib/permission-catalogue';
import { readActivity, currentStaffSession, normaliseWhatsAppNumber, closeStaffSession } from '@/lib/staff-activity';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const admin = db();
  const [leave, access, profile, effective, staffSession, feed] = await Promise.all([
    admin.from('leave_requests').select('id, leave_type, starts_on, ends_on, reason, status, decided_at, decision_note').eq('user_id', session.account).order('created_at', { ascending: false }).limit(20),
    admin.from('approval_requests').select('id, request_type, resource_type, reason, status, decision_note, created_at, decided_at, decided_by_name').eq('requested_by', session.account).order('created_at', { ascending: false }).limit(20),
    admin.from('profiles').select('full_name, email, phone, whatsapp_opt_in').eq('id', session.account).maybeSingle(),
    admin.from('user_permissions').select('permission_key, effect, expires_at').eq('user_id', session.account),
    currentStaffSession(session).catch(() => null),
    readActivity({ actorId: session.account, limit: 25 }).catch(() => []),
  ]);
  return NextResponse.json({
    leaveRequests: leave.data ?? [],
    accessRequests: access.data ?? [],
    // The personal feed is the audit trail narrowed to this person, so "My
    // workspace" shows exactly the record the administrator can see — nothing
    // is written twice and nothing is invisible to either side.
    activity: feed,
    myGrants: effective.data ?? [],
    // What this account already holds, so the request form only offers what is
    // actually missing.
    myPermissions: session.permissions ?? [],
    profile: {
      name: profile.data?.full_name ?? session.name,
      email: profile.data?.email ?? session.email ?? '',
      phone: profile.data?.phone ?? '',
      whatsappOptIn: profile.data?.whatsapp_opt_in !== false,
    },
    staffSession,
  });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
 
  try {
    const input = await request.json();
    const admin = db();
    if (input.action === 'request-leave') {
      if (!hasPermission(session, 'request_leave')) return NextResponse.json({ error: 'Permission required: request_leave.' }, { status: 403 });
      const startsOn = String(input.startsOn ?? ''); const endsOn = String(input.endsOn ?? '');
      if (!startsOn || !endsOn || endsOn < startsOn) return NextResponse.json({ error: 'A valid date range is required.' }, { status: 400 });
      const leaveType = String(input.leaveType ?? 'annual').slice(0, 50);
      const { data: created, error } = await admin.from('leave_requests').insert({ user_id: session.account, leave_type: leaveType, starts_on: startsOn, ends_on: endsOn, reason: String(input.reason ?? '').slice(0, 1000) }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'leave_requested', targetType: 'LeaveRequest', targetId: created.id, detail: `Leave requested ${startsOn} → ${endsOn}`, severity: 'info' });
      // This form wrote the request and told nobody, which is why requests made
      // from "My workspace" also failed to appear to an administrator.
      const notified = await notifyLeaveSubmitted({ requesterId: session.account, requesterName: session.name, leaveType, startsOn, endsOn, requestId: created.id });
      return NextResponse.json({ ok: true, notified });
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
      // Reject anything outside the central catalogue: an unknown key can never be
      // granted, so accepting it would leave a dead request in the approval inbox.
      if (!isPermissionKey(permission)) return NextResponse.json({ error: 'That permission is not in the approved catalogue.' }, { status: 400 });
      // A request that nobody is told about is a request that never arrives.
      // The row, the notification to every administrator and the audit line are
      // written together; the count is returned so the client can say how many
      // people were actually told.
      const { data: created, error } = await admin.from('approval_requests').insert({
        request_type: 'access_request', resource_type: 'permission', resource_id: null,
        requested_by: session.account, requested_by_name: session.name, requested_by_role: session.role,
        reason, status: 'Pending', payload: { permission },
      }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const notified = await notifyAccessRequested({
        requesterId: session.account, requesterName: session.name, permission, reason, requestId: created.id,
      });
      if (notified > 0) {
        await admin.from('approval_requests').update({ notified_admin_count: notified }).eq('id', created.id);
      }
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'access_requested', targetType: 'ApprovalRequest', targetId: created.id, detail: `Requested ${permission.replace(/_/g, ' ')} — ${reason}`, severity: 'info' });
      return NextResponse.json({ ok: true, notified });
    }
    if (input.action === 'save-phone') {
      // Everyone who may edit their own profile may also record the number the
      // workspace would reach them on; that is the whole point of the field.
      if (!session.isAdmin && !hasPermission(session, 'edit_whatsapp_contact') && !hasPermission(session, 'edit_own_profile')) {
        return NextResponse.json({ error: 'Permission required: edit_whatsapp_contact.' }, { status: 403 });
      }
      const raw = String(input.phone ?? '').trim();
      const normalised = raw ? normaliseWhatsAppNumber(raw) : null;
      if (raw && !normalised) {
        return NextResponse.json({ error: 'Enter a Kenyan mobile number, for example 0722 123 456 or +254 722 123 456.' }, { status: 400 });
      }
      const optIn = input.whatsappOptIn !== false;
      const { error } = await admin.from('profiles').update({ phone: normalised, whatsapp_opt_in: optIn }).eq('id', session.account);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({
        actorId: session.account, actorName: session.name, actorRole: session.role,
        action: 'update_whatsapp_number', targetType: 'Profile', targetId: session.account,
        detail: normalised
          ? `WhatsApp number set to +${normalised}${optIn ? '' : ' (broadcasts declined)'}`
          : 'WhatsApp number removed',
        severity: 'change',
      });
      return NextResponse.json({ ok: true, phone: normalised ?? '', whatsappOptIn: optIn });
    }

    if (input.action === 'check-out') {
      // Check-out is the end of a person's day: it closes the open session and
      // is written to the activity feed so the administrator sees the person
      // leave, not just disappear from the online list.
      const note = String(input.note ?? '').slice(0, 500);
      try {
        await closeStaffSession({ session, kind: 'checked_out', note });
        // One check-out, recorded once: the attendance register is closed here
        // so the workspace does not also fire its own attendance call and leave
        // two identical lines in the feed.
        await updateAttendance(session.staffId ?? session.account, 'check-out', note, {
          id: session.account, name: session.name, role: session.role,
        }).catch(() => undefined);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Check-out could not be recorded.' }, { status: 400 });
      }
      await recordAudit({
        actorId: session.account, actorName: session.name, actorRole: session.role,
        action: 'check_out', targetType: 'Session', targetId: session.account,
        detail: note ? `Checked out for the day — ${note}` : 'Checked out for the day',
        severity: 'info',
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unsupported self-service action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Self-service action failed.' }, { status: 400 });
  }
}
