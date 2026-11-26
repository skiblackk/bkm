/**
 * Staff presence, check-out and the activity feed.
 *
 * Everything here is server-only. The three concerns live together because
 * they answer one question — "what is this person doing right now, and what did
 * they do today?" — and because a sign-out must be recorded in the same breath
 * as the session closes, or the trail stops making sense.
 */
import { createSupabaseAdminClient } from './supabase/admin';
import type { DemoSession } from './auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Audit verbs that only describe a read. Presence and logging-in events are
 * dropped from the "what the team is doing" feed: an administrator wants to see
 * changes to the business, not a scroll of who opened which page. Nothing is
 * removed from audit_events itself — this is a reading filter only.
 */
const READ_ONLY = new Set([
  'view', 'viewed', 'read', 'open', 'opened', 'sign_in', 'signed_in', 'login',
  'session_opened', 'heartbeat', 'presence', 'page_view', 'use', 'summarise',
]);
function isNoise(action: string, severity: string) {
  const verb = action.toLowerCase();
  return READ_ONLY.has(verb) || verb.startsWith('view_') || (severity === 'info' && verb.endsWith('_viewed'));
}
/** A signed-in browser pings every 30s; five minutes of silence is not online. */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export type StaffSessionRow = {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  signedInAt: string;
  lastSeenAt: string;
  signedOutAt: string | null;
  signOutKind: string | null;
  signOutNote: string | null;
  day: string;
  online: boolean;
};

export type ActivityRow = {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  actionLabel: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  severity: string;
  createdAt: string;
};

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

function mapSession(row: Record<string, unknown> | null): StaffSessionRow | null {
  // The RPC returns an empty composite when no row was updated; that is "no
  // open session", not a session with empty fields.
  if (!row || !row.id) return null;
  const lastSeen = String(row.last_seen_at ?? '');
  const signedOut = row.signed_out_at ? String(row.signed_out_at) : null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userName: String(row.user_name ?? ''),
    userRole: String(row.user_role ?? ''),
    signedInAt: String(row.signed_in_at ?? ''),
    lastSeenAt: lastSeen,
    signedOutAt: signedOut,
    signOutKind: row.sign_out_kind ? String(row.sign_out_kind) : null,
    signOutNote: row.sign_out_note ? String(row.sign_out_note) : null,
    day: String(row.day ?? ''),
    online: !signedOut && Date.parse(lastSeen) > Date.now() - ONLINE_WINDOW_MS,
  };
}

/* ---------------------------------------------------------------- sessions */

/** Open (or refresh) the caller's session for today. Safe to call repeatedly. */
export async function openStaffSession(session: DemoSession, userAgent: string | null) {
  const userId = session.staffId ?? session.account;
  if (!UUID.test(userId)) return null;
  const admin = db();
  const { data, error } = await admin.rpc('bkm_open_session', {
    p_user_id: userId,
    p_user_name: session.name,
    p_user_role: session.role,
    p_user_agent: userAgent ? userAgent.slice(0, 400) : null,
  });
  if (error || !data) return null;
  return mapSession(data as Record<string, unknown>);
}

export async function pingStaffSession(session: DemoSession) {
  const userId = session.staffId ?? session.account;
  if (!UUID.test(userId)) return null;
  const admin = db();
  await admin.rpc('bkm_session_ping', { p_user_id: userId });
  const { data } = await admin
    .from('staff_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('signed_out_at', null)
    .maybeSingle();
  return mapSession((data ?? null) as Record<string, unknown> | null);
}

/** The caller's open session, if any. */
export async function currentStaffSession(session: DemoSession) {
  const userId = session.staffId ?? session.account;
  if (!UUID.test(userId)) return null;
  const admin = db();
  const { data } = await admin
    .from('staff_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('signed_out_at', null)
    .maybeSingle();
  return mapSession((data ?? null) as Record<string, unknown> | null);
}

export async function closeStaffSession(input: {
  session: DemoSession;
  kind?: 'signed_out' | 'checked_out' | 'forced';
  note?: string;
  targetUserId?: string | null;
  force?: boolean;
}) {
  const userId = input.session.staffId ?? input.session.account;
  if (!UUID.test(userId)) throw new Error('Your account is not a provisioned staff profile.');
  const admin = db();
  const { data, error } = await admin.rpc('bkm_close_session', {
    p_user_id: userId,
    p_kind: input.kind ?? 'signed_out',
    p_note: input.note ?? null,
    p_target: input.targetUserId ?? null,
    p_force: input.force === true,
  });
  if (error) throw new Error(error.message);
  return mapSession((data ?? null) as Record<string, unknown> | null);
}

/** Everyone's state for today, plus open sessions carried over from before. */
export async function listStaffSessions(): Promise<{ sessions: StaffSessionRow[]; summary: { onDuty: number; online: number; signedOutToday: number } }> {
  const admin = db();
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const [{ data: open }, { data: recent }] = await Promise.all([
    admin.from('staff_sessions').select('*').is('signed_out_at', null).order('signed_in_at', { ascending: true }),
    admin.from('staff_sessions').select('*').gte('signed_in_at', since).order('signed_in_at', { ascending: false }).limit(120),
  ]);
  const rows = [...(open ?? []), ...(recent ?? [])];
  const seen = new Set<string>();
  const sessions = rows
    .filter((row) => {
      const id = String(row.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((row) => mapSession(row as Record<string, unknown>))
    .filter((row): row is StaffSessionRow => row !== null);
  return {
    sessions,
    summary: {
      onDuty: sessions.filter((row) => !row.signedOutAt).length,
      online: sessions.filter((row) => row.online).length,
      signedOutToday: sessions.filter((row) => row.signedOutAt).length,
    },
  };
}

/* ---------------------------------------------------------------- activity */

function mapActivity(row: Record<string, unknown>, names: Map<string, string>): ActivityRow {
  const actorId = row.actor_id ? String(row.actor_id) : null;
  const storedName = String(row.actor_name ?? '');
  // Older rows wrote the uuid into actor_name; read the profile instead so the
  // feed never shows an account id where a person's name belongs.
  const actorName = UUID.test(storedName) ? (names.get(storedName) ?? names.get(actorId ?? '') ?? 'Workspace user') : (storedName || names.get(actorId ?? '') || 'Workspace user');
  return {
    id: String(row.id),
    actorId,
    actorName,
    actorRole: String(row.actor_role ?? 'Team member'),
    action: String(row.action ?? ''),
    actionLabel: String(row.action_label ?? String(row.action ?? '').replace(/_/g, ' ')),
    targetType: String(row.target_type ?? ''),
    targetId: row.target_id ? String(row.target_id) : null,
    detail: String(row.detail ?? '').replace(UUID_IN_TEXT, 'a staff record'),
    severity: String(row.severity ?? 'info'),
    createdAt: String(row.created_at ?? ''),
  };
}

export async function readActivity(input: { actorId?: string | null; limit?: number; severity?: string } = {}): Promise<ActivityRow[]> {
  const admin = db();
  let query = admin.from('staff_activity_feed').select('*').order('created_at', { ascending: false }).limit(Math.min(input.limit ?? 40, 200));
  if (input.actorId && UUID.test(input.actorId)) query = query.eq('actor_id', input.actorId);
  if (input.severity) query = query.eq('severity', input.severity);
  const { data, error } = await query;
  if (error) {
    // A deployment without 021 yet should degrade to an empty feed rather than
    // break the workspace screen.
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = Array.from(new Set(rows.map((row) => String(row.actor_id ?? '')).filter((id) => UUID.test(id))));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', ids);
    for (const profile of profiles ?? []) names.set(String(profile.id), String(profile.full_name ?? 'Workspace user'));
  }
  return rows
    .map((row) => mapActivity(row, names))
    .filter((row) => !isNoise(row.action, row.severity));
}

/* --------------------------------------------------------------- telephone */

/**
 * Normalise a Kenyan mobile number to the international form WhatsApp expects.
 *
 *   0722 123 456      -> 254722123456
 *   +254 722 123456   -> 254722123456
 *   254-722-123456    -> 254722123456
 *
 * Returns null for anything that is not a plausible mobile number, so a typo is
 * rejected at the point of entry rather than failing silently at broadcast time.
 */
export function normaliseWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  let value = digits;
  if (value.startsWith('254')) {
    // keep
  } else if (value.startsWith('0')) {
    value = `254${value.slice(1)}`;
  } else if (value.length === 9) {
    value = `254${value}`;
  } else {
    return null;
  }
  // Kenyan mobile: 2547XXXXXXXX or 2541XXXXXXXX (Safaricom, Airtel, Telkom, Equitel)
  if (!/^254(7|1)\d{8}$/.test(value)) return null;
  return value;
}

export function whatsappChatLink(phone: string, message: string) {
  return `https://wa.me/${normaliseWhatsAppNumber(phone) ?? phone}?text=${encodeURIComponent(message)}`;
}

export type WhatsAppRecipient = { staffId: string; name: string; role: string; phone: string | null; optedOut: boolean };

/** Every active staff member and the number a broadcast would reach them on. */
export async function listWhatsAppRecipients(): Promise<WhatsAppRecipient[]> {
  const admin = db();
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, whatsapp_opt_in, active, approval_status, roles(name)')
    .eq('active', true)
    .order('full_name');
  // The same person can hold two sign-in rows (a test fixture beside the real
  // account); a broadcast must still address one chat, not two.
  const seen = new Set<string>();
  return (profiles ?? []).filter((profile) => {
    const key = String(profile.email ?? profile.id).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((profile) => {
    const roleRow = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
    return {
      staffId: String(profile.id),
      name: String(profile.full_name ?? 'Team member'),
      role: String((roleRow as { name?: string } | null)?.name ?? 'Team member'),
      phone: profile.phone ? String(profile.phone) : null,
      optedOut: profile.whatsapp_opt_in === false,
    };
  });
}
