import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Conversation history for the assistants.
 *
 * The complaint was simple: leaving a screen destroyed the conversation. Every
 * assistant now writes through these helpers, so "leaving" is just closing a
 * window — the conversation is in the database and reopens where it stopped.
 *
 * A conversation belongs to one person and one surface (work assistant, register
 * agent, management copilot). The surface matters: nobody wants the register
 * agent's client interviews showing up in the copilot's history.
 */

export type Surface = 'assistant' | 'agent' | 'copilot';

export type StoredMessage = {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

function db() {
  return createSupabaseAdminClient();
}

/** Open a new conversation and return its id, or null if storage is unavailable. */
export async function startConversation(
  profileId: string,
  surface: Surface,
  title: string,
  clientId?: string | null,
): Promise<string | null> {
  const admin = db();
  if (!admin) return null;
  const cleanTitle = title.trim().slice(0, 90) || 'New conversation';
  const { data, error } = await admin
    .from('ai_conversations')
    .insert({ profile_id: profileId, surface, title: cleanTitle, client_id: clientId ?? null })
    .select('id')
    .single();
  if (error) {
    console.error('[conversations] could not open a conversation:', error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

/**
 * Is this conversation real, and does it belong to this person?
 *
 * Checked before every read and write. Without it, passing somebody else's
 * conversation id would read their history.
 */
export async function ownsConversation(profileId: string, conversationId: string, surface: Surface): Promise<boolean> {
  const admin = db();
  if (!admin) return false;
  const { data } = await admin
    .from('ai_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('profile_id', profileId)
    .eq('surface', surface)
    .maybeSingle();
  return Boolean(data);
}

export async function appendMessages(
  conversationId: string,
  entries: Array<{ role: 'user' | 'assistant'; content: string; metadata?: Record<string, unknown> | null }>,
): Promise<void> {
  const admin = db();
  if (!admin || !entries.length) return;
  const { error } = await admin.from('ai_messages').insert(
    entries.map((entry) => ({
      conversation_id: conversationId,
      role: entry.role,
      content: entry.content,
      metadata: entry.metadata ?? null,
    })),
  );
  // Losing a history write must never break the answer being shown.
  if (error) console.error('[conversations] could not store messages:', error.message);
}

export async function loadMessages(profileId: string, conversationId: string, surface: Surface): Promise<StoredMessage[]> {
  const admin = db();
  if (!admin) return [];
  if (!(await ownsConversation(profileId, conversationId, surface))) return [];
  const { data } = await admin
    .from('ai_messages')
    .select('id, role, content, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at');
  return ((data ?? []) as Array<{ id: string; role: string; content: string; metadata: Record<string, unknown> | null; created_at: string }>).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}

/** The last N turns, oldest first — the window a model is given as context. */
export async function recentHistory(profileId: string, conversationId: string, surface: Surface, limit = 12): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages = await loadMessages(profileId, conversationId, surface);
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-limit)
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content.slice(0, 4000) }));
}

export async function listConversations(profileId: string, surface: Surface, limit = 30): Promise<ConversationSummary[]> {
  const admin = db();
  if (!admin) return [];
  const { data } = await admin
    .from('ai_conversations')
    .select('id, title, updated_at, ai_messages(count)')
    .eq('profile_id', profileId)
    .eq('surface', surface)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<{ id: string; title: string; updated_at: string; ai_messages: Array<{ count: number }> | null }>).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    messageCount: Array.isArray(row.ai_messages) ? Number(row.ai_messages[0]?.count ?? 0) : 0,
  }));
}

/**
 * The most recent conversation for this person, so a panel can open onto the
 * last thing they were doing instead of an empty screen.
 */
export async function latestConversation(profileId: string, surface: Surface): Promise<string | null> {
  const [first] = await listConversations(profileId, surface, 1);
  return first?.id ?? null;
}

export async function renameConversation(profileId: string, conversationId: string, surface: Surface, title: string): Promise<boolean> {
  const admin = db();
  if (!admin) return false;
  if (!(await ownsConversation(profileId, conversationId, surface))) return false;
  const { error } = await admin
    .from('ai_conversations')
    .update({ title: title.trim().slice(0, 90) || 'Untitled conversation' })
    .eq('id', conversationId)
    .eq('profile_id', profileId);
  return !error;
}

/**
 * Remove a conversation from the list without destroying it.
 *
 * Archive, not delete: a chat is a record of what somebody was told, and the
 * system already learned the cost of an irreversible delete.
 */
export async function archiveConversation(profileId: string, conversationId: string, surface: Surface): Promise<boolean> {
  const admin = db();
  if (!admin) return false;
  if (!(await ownsConversation(profileId, conversationId, surface))) return false;
  const { error } = await admin
    .from('ai_conversations')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('profile_id', profileId);
  return !error;
}
