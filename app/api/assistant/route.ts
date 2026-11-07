import { NextResponse } from 'next/server';
import { createTask, getSnapshot, updateTask } from '@/lib/data-access';
import { z } from 'zod';
import { hasPermission, requirePermission } from '@/lib/auth';
import { askCeoCopilot } from '@/lib/ceo-copilot';
import { isProductionDataMode, hasSupabaseConfiguration } from '@/lib/runtime-mode';

const schema = z.object({ question: z.string().min(2).max(2000) });

async function findRequestedTask(question: string) {
  const lower = question.toLowerCase();
  return (await getSnapshot()).tasks.find((task) => task.title.toLowerCase().split(/\s+/).filter((word) => word.length > 4).some((word) => lower.includes(word)));
}

export async function POST(request: Request) {
  try {
    if (isProductionDataMode && !hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
    const session = await requirePermission('use_assistant');
    const { question } = schema.parse(await request.json());
    const lower = question.toLowerCase();
    if (/(create|add|make|open)\s+(a\s+)?task/.test(lower)) {
      if (!hasPermission(session, 'manage_tasks')) throw new Error('Task-management permission is required for assistant task creation.');
      const title = question.replace(/.*?(?:create|add|make|open)\s+(?:a\s+)?task\s*(?:to|for|called|named)?\s*/i, '').trim().replace(/[.?!]+$/, '') || 'Follow up on requested work';
      const snapshot = await createTask({ title });
      return NextResponse.json({ answer: `I created “${title}” in the task register as Not Started. It is ready for assignment and review.`, tool: 'create_task', recordCount: snapshot.tasks.length, source: 'assistant action' });
    }
    if (/(mark|set|move|change).*\s(complete|completed|done)/.test(lower)) {
      if (!hasPermission(session, 'manage_tasks')) throw new Error('Task-management permission is required for assistant task updates.');
      const task = await findRequestedTask(question);
      if (!task) return NextResponse.json({ answer: 'I could not identify the task to mark complete. Include a distinctive part of its title.', tool: 'task_action_needs_clarification', recordCount: 0, source: 'assistant action' });
      const snapshot = await updateTask(task.id, { status: 'Completed' });
      return NextResponse.json({ answer: `I marked “${task.title}” as Completed in the task register.`, tool: 'complete_task', recordCount: snapshot?.tasks.length ?? 0, source: 'assistant action' });
    }
    const result = await askCeoCopilot(question, session);
    return NextResponse.json({ ...result, tool: 'live_grounded_copilot', recordCount: result.evidence.length, source: `live model ${result.model}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Assistant could not complete the request.';
    // Configuration and provider failures must be visible, never masked by a
    // canned answer that looks like a live one.
    const status = /not configured|HTTP 4|HTTP 5/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message, configured: status !== 503 }, { status });
  }
}
