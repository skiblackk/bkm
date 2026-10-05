const DEFAULT_API_BASE = 'https://api.respond.io/v2';
const DEFAULT_GMAIL_CHANNEL_ID = 563627;

type RespondRequestOptions = RequestInit & { query?: Record<string, string | number | undefined> };

function getConfig() {
  return {
    token: process.env.RESPOND_IO_API_TOKEN,
    baseUrl: (process.env.RESPOND_IO_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, ''),
    gmailChannelId: Number(process.env.RESPOND_IO_GMAIL_CHANNEL_ID || DEFAULT_GMAIL_CHANNEL_ID),
    workspaceId: process.env.RESPOND_IO_WORKSPACE_ID || '479271',
  };
}

export function getRespondIoStatus() {
  const config = getConfig();
  return {
    provider: 'Respond.io',
    workspaceId: config.workspaceId,
    gmailChannelId: config.gmailChannelId,
    channelName: 'SMTP - Gmail',
    providerChannelConnected: true,
    bridgeConfigured: Boolean(config.token),
    bridgeMessage: config.token
      ? 'Server bridge configured. Gmail messages can be read and approved replies can be sent.'
      : 'Add RESPOND_IO_API_TOKEN to enable live server-side message sync and sending.',
  };
}

async function respondRequest<T>(path: string, options: RespondRequestOptions = {}): Promise<T> {
  const config = getConfig();
  if (!config.token) throw new Error('Respond.io server bridge is not configured. Add RESPOND_IO_API_TOKEN in the deployment secret store.');
  const url = new URL(`${config.baseUrl}${path}`);
  Object.entries(options.query ?? {}).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, String(value)); });
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${config.token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, cache: 'no-store' });
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'message' in payload ? String((payload as { message: unknown }).message) : `HTTP ${response.status}`;
    throw new Error(`Respond.io request failed: ${detail}`);
  }
  return payload as T;
}

export type RespondMessage = {
  messageId?: number;
  contactId?: number;
  channelId?: number;
  traffic?: 'incoming' | 'outgoing';
  message?: { type?: string; text?: string; subject?: string; [key: string]: unknown };
  sender?: { source?: string; userId?: number; teamId?: number };
  status?: Array<{ value?: string; timestamp?: number; message?: string }>;
};

export async function listContactMessages(identifier: string, limit = 25, cursorId?: number) {
  return respondRequest<{ items: RespondMessage[]; pagination?: { next?: string; previous?: string } }>(`/contact/${encodeURIComponent(identifier)}/message/list`, { query: { limit: Math.min(Math.max(limit, 1), 50), cursorId } });
}

export async function sendGmailMessage(input: { identifier: string; subject?: string; text?: string; replyToMessageId?: number; cc?: string[]; bcc?: string[] }) {
  const config = getConfig();
  return respondRequest<{ messageId: number }>(`/contact/${encodeURIComponent(input.identifier)}/message`, {
    method: 'POST',
    body: JSON.stringify({
      channelId: config.gmailChannelId,
      message: { type: 'email', subject: input.subject, text: input.text, replyToMessageId: input.replyToMessageId, cc: input.cc, bcc: input.bcc },
    }),
  });
}
