import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import { crossSiteRequest, blocked } from '../guard';
import { getPublicQuotation, recordDecision, getQuotation } from '@/lib/quotation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The client's decision, recorded from the shared quotation link.
 *
 * This is the only quotation route without a staff session: the quotation's
 * unguessable token is the credential. It can therefore only ever touch one
 * row, only in the direction a client is allowed to go (Sent/Viewed →
 * Accepted/Rejected), and never exposes anything the client was not already
 * shown on the page. Nothing is converted to an invoice here — that stays a
 * staff action.
 */

const schema = z.object({
  token: z.string().uuid(),
  decision: z.enum(['Accepted', 'Rejected']),
  decidedBy: z.string().trim().min(2, 'Please add your name.').max(160),
  note: z.string().trim().max(1000).optional(),
});

// Per-instance throttle: a shared link should not accept a burst of decisions.
const recent = new Map<string, number>();
const WINDOW_MS = 60_000;

export async function POST(request: Request) {
  if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The service is not configured.' }, { status: 503 });
  if (crossSiteRequest(request)) return blocked();

  const now = Date.now();
  const stale: string[] = [];
  recent.forEach((at, key) => { if (now - at > WINDOW_MS) stale.push(key); });
  for (const key of stale) recent.delete(key);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Please check the details.' }, { status: 422 });
  }
  const input = parsed.data;

  const last = recent.get(input.token);
  if (last && now - last < 8_000) {
    return NextResponse.json({ error: 'Your previous response is still being saved. Give it a moment.' }, { status: 429 });
  }

  const quotation = await getPublicQuotation(input.token, { markViewed: false }).catch(() => null);
  if (!quotation) return NextResponse.json({ error: 'This quotation link is not valid.' }, { status: 404 });
  if (quotation.status === 'Accepted' || quotation.status === 'Rejected') {
    return NextResponse.json({ quotation: { status: quotation.status }, message: `This quotation was already ${quotation.status.toLowerCase()}.` });
  }
  if (quotation.status !== 'Sent' && quotation.status !== 'Viewed') {
    return NextResponse.json({ error: 'This quotation is not open for a decision. Contact your engagement partner.' }, { status: 409 });
  }

  recent.set(input.token, now);
  try {
    await recordDecision(quotation.id, {
      decision: input.decision,
      decidedBy: input.decidedBy,
      note: input.note,
      convert: false,
      actor: { id: null, name: `${input.decidedBy} (client)` },
      channel: 'client',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The decision could not be recorded.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const after = await getQuotation(quotation.id);
  return NextResponse.json({
    status: after?.status ?? input.decision,
    decidedBy: input.decidedBy,
    message: input.decision === 'Accepted'
      ? `Thank you — your acceptance of ${quotation.number} has been recorded.`
      : `Your decision on ${quotation.number} has been recorded.`,
  });
}
