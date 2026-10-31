import { NextResponse } from 'next/server';
import { acceptWebhook, getCommunicationAlerts, getWebhookStatus, type CommunicationChannel } from '@/lib/communication-webhooks';

const channels = new Set<CommunicationChannel>(['gmail', 'sms', 'whatsapp']);
export async function GET() { return NextResponse.json({ channels: getWebhookStatus(), alerts: getCommunicationAlerts() }); }
export async function POST(request: Request) {
  const url = new URL(request.url); const channel = url.searchParams.get('channel') as CommunicationChannel;
  if (!channels.has(channel)) return NextResponse.json({ error: 'Use channel=gmail, channel=sms or channel=whatsapp.' }, { status: 400 });
  try { const payload = await request.json(); const alert = acceptWebhook(channel, payload, request.headers.get('x-bkm-webhook-secret') ?? request.headers.get('x-webhook-secret')); return NextResponse.json({ ok: true, alert }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Webhook could not be accepted.' }, { status: 401 }); }
}
