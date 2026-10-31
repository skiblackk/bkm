import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getInternalMessages, getSnapshot, sendInternalMessage } from '@/lib/repository';
import { getPrivateConversation, listPrivateConversations, markConversationRead, sendPrivateMessage } from '@/lib/private-messaging';

function participantId(session: Awaited<ReturnType<typeof getDemoSession>>) { return session?.staffId ?? session?.account ?? ''; }
function peopleForSession(session: NonNullable<Awaited<ReturnType<typeof getDemoSession>>>) {
  const staff = getSnapshot().staff.map((member) => ({ id: member.id, name: member.name, role: member.role }));
  if (!session.isAdmin) staff.push({ id: 'benjamin', name: 'Benjamin Mutua', role: 'System Administrator' });
  return staff.filter((member, index, all) => all.findIndex((item) => item.id === member.id) === index && member.id !== participantId(session));
}

export async function GET(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  const id = participantId(session);
  const conversationId = new URL(request.url).searchParams.get('conversationId');
  try {
    if (conversationId) return NextResponse.json({ ...getPrivateConversation(conversationId, id), staff: peopleForSession(session) });
    return NextResponse.json({ conversations: listPrivateConversations(id), staff: peopleForSession(session), messages: getInternalMessages().filter((message) => message.senderId === id || message.recipientId === id || (message.recipientId === 'all' && !session.isAdmin)) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Conversation access denied.' }, { status: 403 }); }
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  if (!hasPermission(session, 'send_messages')) return NextResponse.json({ error: 'Message permission is required.' }, { status: 403 });
  try {
    const input = await request.json() as { recipientId?: string; body?: string; clientMessageId?: string };
    const senderId = participantId(session);
    if (input.recipientId === 'all') {
      if (!session.isAdmin) return NextResponse.json({ error: 'Only the administrator can broadcast to all users.' }, { status: 403 });
      const message = sendInternalMessage({ senderId, senderName: session.name, recipientId: 'all', recipientName: 'All users', body: input.body ?? '', kind: 'broadcast' });
      return NextResponse.json({ message, kind: 'broadcast' }, { status: 201 });
    }
    const recipient = peopleForSession(session).find((member) => member.id === input.recipientId);
    if (!recipient) return NextResponse.json({ error: 'Choose an authorized staff member.' }, { status: 400 });
    const message = sendPrivateMessage({ senderId, senderName: session.name, recipientId: recipient.id, recipientName: recipient.name, body: input.body ?? '', clientMessageId: input.clientMessageId });
    return NextResponse.json({ message, kind: 'private' }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Message could not be sent.' }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  try {
    const input = await request.json() as { conversationId?: string };
    if (!input.conversationId) return NextResponse.json({ error: 'A conversation is required.' }, { status: 400 });
    return NextResponse.json(markConversationRead(input.conversationId, participantId(session)));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Conversation could not be marked as read.' }, { status: 403 }); }
}
