import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import {
  appendMessages, archiveConversation, latestConversation, listConversations,
  loadMessages, ownsConversation, startConversation,
} from '@/lib/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Conversation history for the work assistant.
 *
 * The assistant kept its conversation in the page, so leaving the screen lost
 * it. These endpoints are the other half of the fix: the panel saves each turn
 * here and reloads it on mount.
 */

async function requireSession() {
  const session = await getDemoSession();
  if (!session) return { error: NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 }) } as const;
  if (!hasPermission(session, 'use_assistant')) return { error: NextResponse.json({ error: 'Permission required: use_assistant.' }, { status: 403 }) } as const;
  return { session } as const;
}

export async function GET(request: Request) {
  const auth = await requireSession();
  if ('error' in auth) return auth.error;
  const url = new URL(request.url);

  const conversationId = url.searchParams.get('conversationId');
  if (conversationId) {
    const messages = await loadMessages(auth.session.account, conversationId, 'assistant');
    if (!messages.length) return NextResponse.json({ error: 'That conversation is not yours, or no longer exists.' }, { status: 404 });
    return NextResponse.json({ conversationId, messages });
  }

  if (url.searchParams.get('latest') === '1') {
    const id = await latestConversation(auth.session.account, 'assistant');
    if (!id) return NextResponse.json({ conversationId: null, messages: [] });
    const messages = await loadMessages(auth.session.account, id, 'assistant');
    return NextResponse.json({ conversationId: id, messages });
  }

  return NextResponse.json({ conversations: await listConversations(auth.session.account, 'assistant') });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if ('error' in auth) return auth.error;
  try {
    const input = await request.json() as {
      conversationId?: string | null;
      role?: 'user' | 'assistant';
      content?: string;
      metadata?: Record<string, unknown> | null;
      title?: string;
    };
    const content = String(input.content ?? '').trim().slice(0, 8000);
    if (!content) return NextResponse.json({ error: 'There is nothing to save.' }, { status: 400 });

    let conversationId = String(input.conversationId ?? '').trim() || null;
    if (conversationId && !(await ownsConversation(auth.session.account, conversationId, 'assistant'))) {
      conversationId = null;
    }
    if (!conversationId) {
      conversationId = await startConversation(auth.session.account, 'assistant', input.title || content);
      if (!conversationId) return NextResponse.json({ error: 'The conversation could not be opened.' }, { status: 503 });
    }

    await appendMessages(conversationId, [{
      role: input.role === 'assistant' ? 'assistant' : 'user',
      content,
      metadata: input.metadata ?? null,
    }]);
    return NextResponse.json({ conversationId });
  } catch {
    return NextResponse.json({ error: 'That message could not be saved.' }, { status: 400 });
  }
}

/** Archiving, not deleting: a conversation is a record of what someone was told. */
export async function DELETE(request: Request) {
  const auth = await requireSession();
  if ('error' in auth) return auth.error;
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  if (!conversationId) return NextResponse.json({ error: 'Which conversation?' }, { status: 400 });
  const archived = await archiveConversation(auth.session.account, conversationId, 'assistant');
  return archived
    ? NextResponse.json({ message: 'Conversation removed from your list. The record is kept.' })
    : NextResponse.json({ error: 'That conversation could not be archived.' }, { status: 404 });
}
