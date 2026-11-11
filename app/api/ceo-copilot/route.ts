import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDemoSession } from '@/lib/auth';
import { askCeoCopilot } from '@/lib/ceo-copilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ question: z.string().trim().min(2).max(4000), gmailEmail: z.string().trim().max(320).optional(), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(12).optional() });

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: 'The leadership briefing is available to administrators.' }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    const result = await askCeoCopilot(input.question, session, input.history ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The CEO Copilot could not complete the request.' }, { status: 400 });
  }
}
