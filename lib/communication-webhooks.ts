import type { InternalMessage } from './types';

export type CommunicationChannel = 'gmail' | 'sms' | 'whatsapp';
export type CommunicationAlert = InternalMessage & { channel: CommunicationChannel; externalId?: string; subject?: string; phone?: string };

let alerts: CommunicationAlert[] = [];

export function getWebhookStatus() {
  return [
    { channel: 'gmail' as const, label: 'Gmail', mode: 'Google Workspace webhook / Pub/Sub', configured: Boolean(process.env.BKM_GMAIL_WEBHOOK_SECRET), endpoint: '/api/webhooks/communications?channel=gmail' },
    { channel: 'sms' as const, label: 'SMS', mode: 'Provider webhook', configured: Boolean(process.env.BKM_SMS_WEBHOOK_SECRET), endpoint: '/api/webhooks/communications?channel=sms' },
    { channel: 'whatsapp' as const, label: 'WhatsApp', mode: 'Respond.io webhook', configured: Boolean(process.env.BKM_WHATSAPP_WEBHOOK_SECRET), endpoint: '/api/webhooks/communications?channel=whatsapp' },
  ];
}

function secretFor(channel: CommunicationChannel) {
  return process.env[`BKM_${channel.toUpperCase()}_WEBHOOK_SECRET`];
}

export function acceptWebhook(channel: CommunicationChannel, payload: Record<string, unknown>, suppliedSecret?: string | null) {
  const expected = secretFor(channel);
  if (expected && suppliedSecret !== expected) throw new Error('Webhook signature did not match the configured channel secret.');
  const data = (payload.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>;
  const sender = String(data.from ?? data.sender ?? data.email ?? data.phone ?? 'External contact');
  const body = String(data.body ?? data.text ?? data.message ?? data.snippet ?? data.subject ?? 'New communication received.');
  const subject = data.subject ? String(data.subject) : undefined;
  const alert: CommunicationAlert = { id: `alert-${Date.now()}`, senderId: `external-${channel}`, senderName: sender, recipientId: 'benjamin', recipientName: 'Benjamin Mutua', body, createdAt: 'Just now', kind: 'alert', channel, externalId: data.id ? String(data.id) : undefined, subject, phone: data.phone ? String(data.phone) : undefined };
  alerts.unshift(alert);
  return alert;
}

export function getCommunicationAlerts() { return alerts.slice(0, 50); }
