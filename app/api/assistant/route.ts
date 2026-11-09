import { NextResponse } from 'next/server';
import { createTask, getSnapshot, updateTask } from '@/lib/data-access';
import { z } from 'zod';
import { hasPermission, requirePermission } from '@/lib/auth';
import { askCeoCopilot } from '@/lib/ceo-copilot';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import { getUploadedDocument } from '@/lib/uploaded-documents';
import { answerDocumentQuestion } from '@/lib/document-analysis';

const schema = z.object({
  question: z.string().min(2).max(2000),
  documentId: z.string().min(1).max(64).optional(),
});

async function findRequestedTask(question: string) {
  const lower = question.toLowerCase();
  return (await getSnapshot()).tasks.find((task) => task.title.toLowerCase().split(/\s+/).filter((word) => word.length > 4).some((word) => lower.includes(word)));
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
    const session = await requirePermission('use_assistant');
    const { question, documentId } = schema.parse(await request.json());
    const lower = question.toLowerCase();

    // A question about an uploaded file is answered from that file, not from
    // company records. The figures are computed server-side.
    if (documentId) {
      const document = await getUploadedDocument(documentId, session.account);
      if (!document) return NextResponse.json({ error: 'That document is no longer available. Upload it again and ask in the same conversation.' }, { status: 404 });
      const result = await answerDocumentQuestion({ filename: document.filename, text: document.extractedText, grid: document.grid, warnings: document.warnings }, question);
      return NextResponse.json({
        answer: result.answer,
        tool: 'document_analysis',
        recordCount: result.analysis.ledger.length,
        evidence: result.analysis.warnings.slice(0, 3),
        model: result.model,
        computed: result.computed,
        analysis: { kind: result.analysis.kind, currency: result.analysis.currency, totals: result.analysis.statements.totals, statements: result.analysis.statements, diagnostics: result.analysis.diagnostics },
        source: `uploaded document ${document.filename}`,
      });
    }
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
