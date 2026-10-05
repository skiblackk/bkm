import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDemoSession } from '@/lib/auth';
import { askCeoCopilot } from '@/lib/ceo-copilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ question: z.string().trim().min(2).max(4000), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(12).optional() });

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  if (!session.isAdmin || session.account !== 'benjamin') return NextResponse.json({ error: 'The CEO Copilot is available only in Benjamin Mutua’s administrator account.' }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await askCeoCopilot(input.question, input.history ?? []));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The CEO Copilot could not complete the request.' }, { status: 400 });
  }
}
