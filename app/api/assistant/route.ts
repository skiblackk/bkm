import { NextResponse } from 'next/server';
import { createTask, formatAssistantAnswer, getSnapshot, searchForAssistant, updateTask } from '@/lib/repository';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth';

const schema = z.object({ question: z.string().min(2).max(2000) });

function findRequestedTask(question: string) {
  const lower = question.toLowerCase();
  return getSnapshot().tasks.find((task) => task.title.toLowerCase().split(/\s+/).filter((word) => word.length > 4).some((word) => lower.includes(word)));
}

export async function POST(request: Request) {
  try {
    await requirePermission('use_assistant');
    const { question } = schema.parse(await request.json());
    const lower = question.toLowerCase();
    if (/(create|add|make|open)\s+(a\s+)?task/.test(lower)) {
      const title = question.replace(/.*?(?:create|add|make|open)\s+(?:a\s+)?task\s*(?:to|for|called|named)?\s*/i, '').trim().replace(/[.?!]+$/, '') || 'Follow up on requested work';
      const snapshot = createTask({ title });
      return NextResponse.json({ answer: `I created “${title}” in the task register as Not Started. It is ready for assignment and review.`, tool: 'create_task', recordCount: snapshot.tasks.length, source: 'assistant action' });
    }
    if (/(mark|set|move|change).*(complete|completed|done)/.test(lower)) {
      const task = findRequestedTask(question);
      if (!task) return NextResponse.json({ answer: 'I could not identify the task to mark complete. Include a distinctive part of its title.', tool: 'task_action_needs_clarification', recordCount: 0, source: 'assistant action' });
      const snapshot = updateTask(task.id, { status: 'Completed' });
      return NextResponse.json({ answer: `I marked “${task.title}” as Completed in the task register.`, tool: 'complete_task', recordCount: snapshot?.tasks.length ?? 0, source: 'assistant action' });
    }
    const result = searchForAssistant(question);
    return NextResponse.json({ answer: formatAssistantAnswer(question, result), tool: result.tool, recordCount: result.records.length, source: 'controlled live server tool' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Assistant could not complete the request.' }, { status: 400 });
  }
}
