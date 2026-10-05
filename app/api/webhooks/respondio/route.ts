import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { acceptWebhook } from '@/lib/communication-webhooks';

export const dynamic = 'force-dynamic';

function validSignature(rawBody: string, signature: string | null) {
  const secret = process.env.RESPOND_IO_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signature.replace(/^sha256=/, '');
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get('x-respond-signature') ?? request.headers.get('x-webhook-signature'))) return NextResponse.json({ error: 'Invalid Respond.io webhook signature.' }, { status: 401 });
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const alert = acceptWebhook('gmail', payload, process.env.BKM_GMAIL_WEBHOOK_SECRET || undefined);
    return NextResponse.json({ ok: true, alert });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Respond.io webhook could not be accepted.' }, { status: 400 });
  }
}
