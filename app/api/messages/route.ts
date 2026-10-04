import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { getInternalMessages, getSnapshot, sendInternalMessage } from '@/lib/repository';

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  return NextResponse.json({ messages: getInternalMessages(), staff: getSnapshot().staff });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  try {
    const input = await request.json();
    const isBroadcast = input.recipientId === 'all';
    if (isBroadcast && !session.isAdmin) return NextResponse.json({ error: 'Only the administrator can broadcast to all users.' }, { status: 403 });
    const staff = getSnapshot().staff.find((member) => member.id === input.recipientId);
    const recipientName = isBroadcast ? 'All users' : staff?.name;
    if (!recipientName) return NextResponse.json({ error: 'Choose a valid user.' }, { status: 400 });
    const message = sendInternalMessage({ senderId: session.staffId ?? session.account, senderName: session.name, recipientId: input.recipientId, recipientName, body: input.body, kind: isBroadcast ? 'broadcast' : 'direct' });
    return NextResponse.json({ message });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Message could not be sent.' }, { status: 400 }); }
}
