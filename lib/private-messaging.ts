/**
 * Private messaging, broadcasts and notifications.
 *
 * These used to live in a process-local map, so a message sent from one
 * serverless instance was invisible to the next request and disappeared on
 * redeploy. The store is now Supabase; the in-memory layer is a short-lived
 * cache for the instance that handled the write.
 */

import type { NotificationRecord, PrivateConversation, PrivateMessage } from './types';
import { createSupabaseAdminClient } from './supabase/admin';

type ConversationRow = { id: string; created_at: string };
type ParticipantRow = { conversation_id: string; profile_id: string };
type MessageRow = { id: string; conversation_id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null };
type NotificationRow = { id: string; recipient_id: string | null; category: string; priority: string; title: string; body: string; link_path: string | null; is_read: boolean; created_at: string; related_id: string | null; dedupe_key: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function client() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Messaging requires the Supabase service key to be configured.');
  return admin;
}

/** Conversations are keyed on the two profile ids, so the pair always lands in one thread. */
async function ensureConversation(a: string, b: string): Promise<string> {
  const admin = client();
  if (!UUID.test(a) || !UUID.test(b)) throw new Error('Messaging needs both people to have a workspace profile.');
  const { data: mine } = await admin.from('conversation_participants').select('conversation_id').eq('profile_id', a);
  const ids = (mine ?? []).map((row) => String(row.conversation_id));
  if (ids.length) {
    const { data: shared } = await admin.from('conversation_participants').select('conversation_id').eq('profile_id', b).in('conversation_id', ids);
    const existing = (shared ?? [])[0]?.conversation_id;
    if (existing) return String(existing);
  }
  const { data: created, error } = await admin.from('conversations').insert({}).select('id').single();
  if (error || !created) throw new Error(error?.message ?? 'The conversation could not be created.');
  const conversationId = String(created.id);
  const { error: joinError } = await admin.from('conversation_participants').insert([
    { conversation_id: conversationId, profile_id: a },
    { conversation_id: conversationId, profile_id: b },
  ]);
  if (joinError) throw new Error(joinError.message);
  return conversationId;
}

async function namesFor(profileIds: string[]): Promise<Record<string, string>> {
  const admin = client();
  const unique = Array.from(new Set(profileIds.filter((id) => UUID.test(id))));
  if (!unique.length) return {};
  const { data } = await admin.from('profiles').select('id, full_name, email').in('id', unique);
  const names: Record<string, string> = {};
  for (const row of data ?? []) names[String(row.id)] = String(row.full_name ?? row.email ?? 'Workspace user');
  return names;
}

export async function listPrivateConversations(participantId: string): Promise<PrivateConversation[]> {
  if (!UUID.test(participantId)) return [];
  const admin = client();
  const { data: mine, error } = await admin.from('conversation_participants').select('conversation_id').eq('profile_id', participantId);
  if (error) throw new Error(error.message);
  const ids = (mine ?? []).map((row) => String(row.conversation_id));
  if (!ids.length) return [];

  const [{ data: participants }, { data: messages }] = await Promise.all([
    admin.from('conversation_participants').select('conversation_id, profile_id').in('conversation_id', ids),
    admin.from('private_messages').select('*').in('conversation_id', ids).order('created_at', { ascending: false }),
  ]);

  const names = await namesFor((participants ?? []).map((row) => String(row.profile_id)));
  const byConversation = new Map<string, string[]>();
  for (const row of participants ?? []) {
    const key = String(row.conversation_id);
    byConversation.set(key, [...(byConversation.get(key) ?? []), String(row.profile_id)]);
  }

  const conversations: PrivateConversation[] = ids.map((id) => {
    const participantIds = byConversation.get(id) ?? [];
    const thread = (messages ?? []).filter((row) => String(row.conversation_id) === id) as MessageRow[];
    const latest = thread[0];
    return {
      id,
      participantIds,
      participantNames: names,
      createdAt: latest?.created_at ?? new Date().toISOString(),
      latestMessage: latest ? toMessage(latest, names) : null,
      unreadCount: thread.filter((row) => String(row.recipient_id) === participantId && !row.read_at).length,
    };
  });
  return conversations.sort((a, b) => (b.latestMessage?.createdAt ?? '').localeCompare(a.latestMessage?.createdAt ?? ''));
}

function toMessage(row: MessageRow, names: Record<string, string>): PrivateMessage {
  const senderId = String(row.sender_id);
  const recipientId = String(row.recipient_id);
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId,
    senderName: names[senderId] ?? 'Workspace user',
    recipientId,
    recipientName: names[recipientId] ?? 'Workspace user',
    body: String(row.body),
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : null,
  } as PrivateMessage;
}

export async function getPrivateConversation(conversationId: string, participantId: string) {
  const admin = client();
  const { data: membership } = await admin.from('conversation_participants').select('profile_id').eq('conversation_id', conversationId);
  const people = (membership ?? []).map((row) => String(row.profile_id));
  if (!people.includes(participantId)) throw new Error('You are not a participant in this conversation.');
  const { data: rows, error } = await admin.from('private_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const names = await namesFor(people);
  const messages = (rows ?? []).map((row) => toMessage(row as MessageRow, names));
  return {
    conversation: { id: conversationId, participantIds: people, participantNames: names, createdAt: messages[0]?.createdAt ?? new Date().toISOString(), latestMessage: messages[messages.length - 1] ?? null, unreadCount: messages.filter((message) => message.recipientId === participantId && !message.readAt).length },
    messages,
  };
}

export async function sendPrivateMessage(input: { senderId: string; senderName: string; recipientId: string; recipientName: string; body: string; clientMessageId?: string }) {
  const body = input.body.trim();
  if (!body) throw new Error('Message cannot be empty.');
  if (body.length > 4000) throw new Error('Message must be 4,000 characters or fewer.');
  const admin = client();
  if (input.clientMessageId) {
    const { data: existing } = await admin.from('private_messages').select('*').eq('client_message_id', input.clientMessageId).eq('sender_id', input.senderId).maybeSingle();
    if (existing) {
      const names = await namesFor([input.senderId, input.recipientId]);
      return toMessage(existing as MessageRow, names);
    }
  }
  const conversationId = await ensureConversation(input.senderId, input.recipientId);
  const { data: created, error } = await admin.from('private_messages').insert({
    conversation_id: conversationId,
    sender_id: input.senderId,
    recipient_id: input.recipientId,
    body,
    client_message_id: input.clientMessageId ?? null,
  }).select('*').single();
  if (error || !created) throw new Error(error?.message ?? 'The message could not be saved.');
  const names = await namesFor([input.senderId, input.recipientId]);
  const message = toMessage(created as MessageRow, names);
  await createNotification({
    recipientId: input.recipientId,
    category: 'Message',
    priority: 'Normal',
    title: `New message from ${input.senderName}`,
    body: body.slice(0, 140),
    linkPath: '/messages',
    relatedId: conversationId,
    dedupeKey: `private-message:${message.id}`,
  }).catch(() => undefined);
  return message;
}

export async function markConversationRead(conversationId: string, participantId: string) {
  const admin = client();
  await admin.from('private_messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('recipient_id', participantId).is('read_at', null);
  await admin.from('notifications').update({ is_read: true }).eq('recipient_id', participantId).eq('related_id', conversationId);
  return getPrivateConversation(conversationId, participantId);
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: String(row.id),
    recipientId: row.recipient_id ? String(row.recipient_id) : '',
    category: String(row.category),
    priority: String(row.priority),
    title: String(row.title),
    body: String(row.body),
    linkPath: row.link_path ?? undefined,
    isRead: Boolean(row.is_read),
    createdAt: String(row.created_at),
    relatedId: row.related_id ?? undefined,
    dedupeKey: row.dedupe_key ?? undefined,
  } as NotificationRecord;
}

export async function listNotifications(recipientId: string, unreadOnly = false) {
  if (!UUID.test(recipientId)) return [];
  const admin = client();
  let query = admin.from('notifications').select('*').eq('recipient_id', recipientId).order('created_at', { ascending: false }).limit(100);
  if (unreadOnly) query = query.eq('is_read', false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toNotification(row as NotificationRow));
}

export async function setNotificationRead(notificationId: string, recipientId: string, isRead: boolean) {
  const admin = client();
  const { data, error } = await admin.from('notifications').update({ is_read: isRead }).eq('id', notificationId).eq('recipient_id', recipientId).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Notification was not found.');
  return toNotification(data as NotificationRow);
}

export async function markAllNotificationsRead(recipientId: string) {
  if (!UUID.test(recipientId)) return [];
  const admin = client();
  await admin.from('notifications').update({ is_read: true }).eq('recipient_id', recipientId).eq('is_read', false);
  return listNotifications(recipientId);
}

export async function createNotification(input: {
  recipientId: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  linkPath?: string;
  relatedId?: string;
  dedupeKey?: string;
}) {
  if (!UUID.test(input.recipientId)) return null;
  const admin = client();
  if (input.dedupeKey) {
    const { data: existing } = await admin.from('notifications').select('*').eq('dedupe_key', input.dedupeKey).maybeSingle();
    if (existing) return toNotification(existing as NotificationRow);
  }
  const { data, error } = await admin.from('notifications').insert({
    recipient_id: input.recipientId,
    category: input.category,
    priority: input.priority,
    title: input.title,
    body: input.body,
    link_path: input.linkPath ?? null,
    related_id: input.relatedId ?? null,
    dedupe_key: input.dedupeKey ?? null,
  }).select('*').single();
  if (error || !data) return null;
  return toNotification(data as NotificationRow);
}
