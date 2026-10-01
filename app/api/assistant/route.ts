import { NextResponse } from 'next/server';
import { formatAssistantAnswer, searchForAssistant } from '@/lib/repository';
import { z } from 'zod';

const schema = z.object({ question: z.string().min(2).max(500) });

export async function POST(request: Request) {
  try {
    const { question } = schema.parse(await request.json());
    const result = searchForAssistant(question);
    return NextResponse.json({ answer: formatAssistantAnswer(question, result), tool: result.tool, recordCount: result.records.length, source: 'controlled read-only server tool' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Assistant could not complete the request.' }, { status: 400 });
  }
}
