import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { getRespondIoStatus, listContactMessages, sendGmailMessage } from '@/lib/respond-io';

export const dynamic = 'force-dynamic';

function forbidden() {
  return NextResponse.json({ error: 'Benjamin Mutua administrator access is required for the Respond.io bridge.' }, { status: 403 });
}

export async function GET(request: Request) {
  const session = await getDemoSession();
  if (!session?.isAdmin) return forbidden();
  const url = new URL(request.url);
  const identifier = url.searchParams.get('identifier');
  if (!identifier) return NextResponse.json({ ok: true, status: getRespondIoStatus(), usage: 'Pass identifier=email:client@example.com to retrieve the Gmail conversation.' });
  try {
    const messages = await listContactMessages(identifier, Number(url.searchParams.get('limit') || 25), Number(url.searchParams.get('cursorId') || 0) || undefined);
    return NextResponse.json({ ok: true, status: getRespondIoStatus(), identifier, ...messages });
  } catch (error) {
    return NextResponse.json({ ok: false, status: getRespondIoStatus(), error: error instanceof Error ? error.message : 'Respond.io message sync failed.' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session?.isAdmin) return forbidden();
  try {
    const body = await request.json() as { identifier?: string; subject?: string; text?: string; replyToMessageId?: number; cc?: string[]; bcc?: string[]; approved?: boolean };
    if (!body.approved) return NextResponse.json({ error: 'Outbound Gmail messages require Benjamin’s explicit approval.' }, { status: 400 });
    if (!body.identifier || !body.text?.trim()) return NextResponse.json({ error: 'identifier and text are required.' }, { status: 400 });
    const result = await sendGmailMessage({ identifier: body.identifier, subject: body.subject, text: body.text.trim(), replyToMessageId: body.replyToMessageId, cc: body.cc, bcc: body.bcc });
    return NextResponse.json({ ok: true, result, status: getRespondIoStatus() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Respond.io message send failed.' }, { status: 502 });
  }
}
