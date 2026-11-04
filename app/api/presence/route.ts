import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getSnapshot } from '@/lib/repository';
import { getPresenceFor, touchPresence } from '@/lib/presence';

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!hasPermission(session, 'send_messages') && !session.isAdmin) return NextResponse.json({ error: 'Presence access is restricted.' }, { status: 403 });
  touchPresence(session);
  const staffIds = getSnapshot().staff.map((member) => member.id).filter((staffId) => staffId !== session.staffId);
  return NextResponse.json({ presence: getPresenceFor(staffIds) });
}

export async function POST() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  if (!hasPermission(session, 'send_messages') && !session.isAdmin) return NextResponse.json({ error: 'Presence access is restricted.' }, { status: 403 });
  return NextResponse.json({ presence: touchPresence(session) });
}
