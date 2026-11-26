import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import {
  openStaffSession, pingStaffSession, closeStaffSession, currentStaffSession,
  listStaffSessions, readActivity, listWhatsAppRecipients, normaliseWhatsAppNumber,
  whatsappChatLink,
} from '@/lib/staff-activity';
import { recordAudit } from '@/lib/data-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staff presence and the activity feed.
 *
 * GET  — who is on duty today plus the activity feed. A staff member sees their
 *        own rows; an administrator or anyone holding view_staff_activity sees
 *        everybody's.
 * POST — open / ping / close a session, and prepare a WhatsApp broadcast.
 */
export async function GET(request: Request) {
  if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production repository is not configured.' }, { status: 503 });
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') ?? 'self';
  const canSeeTeam = session.isAdmin
    || hasPermission(session, 'view_staff_activity')
    || hasPermission(session, 'view_team_dashboard')
    || hasPermission(session, 'view_user_directory');

  if (scope === 'team' && !canSeeTeam) {
    return NextResponse.json({ error: 'Permission required: view_staff_activity.' }, { status: 403 });
  }

  const [activity, staffSession, sessions] = await Promise.all([
    readActivity(scope === 'team' && canSeeTeam ? { limit: 60 } : { actorId: session.account, limit: 30 }).catch(() => []),
    currentStaffSession(session).catch(() => null),
    canSeeTeam ? listStaffSessions().catch(() => ({ sessions: [], summary: { onDuty: 0, online: 0, signedOutToday: 0 } })) : Promise.resolve(null),
  ]);

  const recipients = canSeeTeam && hasPermission(session, 'broadcast_whatsapp')
    ? await listWhatsAppRecipients().catch(() => [])
    : [];

  return NextResponse.json({
    activity,
    scope: scope === 'team' && canSeeTeam ? 'team' : 'self',
    canSeeTeam,
    staffSession,
    sessions,
    recipients,
  });
}

export async function POST(request: Request) {
  if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production repository is not configured.' }, { status: 503 });
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action ?? '');

  try {
    if (action === 'open') {
      const opened = await openStaffSession(session, request.headers.get('user-agent'));
      return NextResponse.json({ staffSession: opened });
    }

    if (action === 'ping') {
      const pinged = await pingStaffSession(session);
      return NextResponse.json({ staffSession: pinged });
    }

    if (action === 'close') {
      const closed = await closeStaffSession({
        session,
        kind: (String(body?.kind ?? 'signed_out') as 'signed_out' | 'checked_out' | 'forced'),
        note: body?.note ? String(body.note).slice(0, 500) : undefined,
      });
      await recordAudit({
        actorId: session.account, actorName: session.name, actorRole: session.role,
        action: 'signed_out', targetType: 'Session', targetId: session.account,
        detail: body?.note ? `Signed out — ${String(body.note).slice(0, 200)}` : 'Signed out of the workspace',
        severity: 'info',
      });
      return NextResponse.json({ staffSession: closed });
    }

    if (action === 'force-close') {
      if (!session.isAdmin && !hasPermission(session, 'force_checkout')) {
        return NextResponse.json({ error: 'Permission required: force_checkout.' }, { status: 403 });
      }
      const targetId = String(body?.userId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return NextResponse.json({ error: 'Choose a staff member.' }, { status: 400 });
      const closed = await closeStaffSession({
        session,
        kind: 'forced',
        note: body?.note ? String(body.note).slice(0, 500) : `Closed by ${session.name}`,
        targetUserId: targetId,
        force: true,
      });
      const admin = createSupabaseAdminClient();
      if (admin) {
        await admin.from('notifications').insert({
          recipient_id: targetId,
          category: 'attendance',
          priority: 'normal',
          title: 'Your session was closed',
          body: `${session.name} closed your open workspace session from the administrator console. Sign in again when you are back.`,
          link_path: '/',
          related_type: 'session',
        }).then(() => undefined, () => undefined);
      }
      await recordAudit({
        actorId: session.account, actorName: session.name, actorRole: session.role,
        action: 'force_checkout', targetType: 'Session', targetId,
        detail: `${closed?.userName || 'A staff member'} was checked out by an administrator`,
        severity: 'security',
      });
      return NextResponse.json({ staffSession: closed });
    }

    if (action === 'broadcast-whatsapp') {
      if (!session.isAdmin && !hasPermission(session, 'broadcast_whatsapp')) {
        return NextResponse.json({ error: 'Permission required: broadcast_whatsapp.' }, { status: 403 });
      }
      const message = String(body?.message ?? '').trim();
      if (!message) return NextResponse.json({ error: 'Write the message first.' }, { status: 400 });
      if (message.length > 900) return NextResponse.json({ error: 'Keep the broadcast under 900 characters so it fits one WhatsApp message.' }, { status: 400 });

      const senderNumber = normaliseWhatsAppNumber(body?.senderNumber ? String(body.senderNumber) : null);
      const admin = createSupabaseAdminClient();
      if (!admin) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

      const everyone = await listWhatsAppRecipients();
      const requested = Array.isArray(body?.staffIds) ? (body.staffIds as string[]) : null;
      const audience = requested && requested.length ? everyone.filter((person) => requested.includes(person.staffId)) : everyone;
      const reachable = audience.filter((person) => person.phone && !person.optedOut);

      const { data: created, error } = await admin.from('whatsapp_broadcasts').insert({
        sent_by: /^[0-9a-f-]{36}$/i.test(session.account) ? session.account : null,
        sent_by_name: session.name,
        sender_number: senderNumber,
        body: message,
        audience: requested && requested.length ? 'selected_staff' : 'all_staff',
        recipient_count: reachable.length,
        recipient_ids: reachable.map((person) => person.staffId),
      }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      if (reachable.length) {
        await admin.from('whatsapp_broadcast_recipients').insert(reachable.map((person) => ({
          broadcast_id: created.id,
          staff_id: person.staffId,
          staff_name: person.name,
          phone: person.phone as string,
        })));
      }

      await recordAudit({
        actorId: session.account, actorName: session.name, actorRole: session.role,
        action: 'broadcast_whatsapp', targetType: 'WhatsAppBroadcast', targetId: String(created.id),
        detail: `WhatsApp broadcast prepared for ${reachable.length} staff member${reachable.length === 1 ? '' : 's'}`,
        severity: 'info',
      });

      // The links are returned one per person so the browser can walk them. A
      // personal WhatsApp number can only be the sender when the message is
      // sent from that phone — the server cannot send on a user's behalf.
      return NextResponse.json({
        broadcast: {
          id: String(created.id),
          body: message,
          senderNumber,
          recipients: reachable.map((person) => ({
            staffId: person.staffId,
            name: person.name,
            role: person.role,
            phone: person.phone,
            link: whatsappChatLink(person.phone as string, message),
          })),
        },
        skipped: audience
          .filter((person) => !person.phone || person.optedOut)
          .map((person) => ({ name: person.name, reason: person.phone ? 'declined broadcasts' : 'no WhatsApp number on file' })),
      });
    }

    if (action === 'mark-broadcast-reached') {
      if (!session.isAdmin && !hasPermission(session, 'broadcast_whatsapp')) {
        return NextResponse.json({ error: 'Permission required: broadcast_whatsapp.' }, { status: 403 });
      }
      const broadcastId = String(body?.broadcastId ?? '');
      const staffId = String(body?.staffId ?? '');
      const admin = createSupabaseAdminClient();
      if (!admin) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
      await admin.from('whatsapp_broadcast_recipients')
        .update({ reached_at: new Date().toISOString() })
        .eq('broadcast_id', broadcastId).eq('staff_id', staffId);
      const { count } = await admin.from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId).not('reached_at', 'is', null);
      await admin.from('whatsapp_broadcasts').update({ delivered_count: count ?? 0 }).eq('id', broadcastId);
      return NextResponse.json({ reached: count ?? 0 });
    }

    return NextResponse.json({ error: 'That action is not recognised.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The action could not be completed.' }, { status: 400 });
  }
}
