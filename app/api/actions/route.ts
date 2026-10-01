import { NextResponse } from 'next/server';
import { createQuotation, createReport, updateTask } from '@/lib/repository';
import { z } from 'zod';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('updateTask'), taskId: z.string(), status: z.string().optional(), assignedTo: z.string().optional() }),
  z.object({ action: z.literal('createQuotation'), clientId: z.string(), service: z.string(), description: z.string(), terms: z.string(), items: z.array(z.object({ id: z.string(), description: z.string(), quantity: z.number(), unitPrice: z.number() })) }),
  z.object({ action: z.literal('createReport'), clientId: z.string(), engagementId: z.string(), reportType: z.string() }),
]);

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    if (input.action === 'updateTask') {
      const snapshot = updateTask(input.taskId, { status: input.status as never, assignedTo: input.assignedTo });
      if (!snapshot) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      return NextResponse.json({ snapshot, message: 'Task updated in the demonstration environment.' });
    }
    if (input.action === 'createQuotation') return NextResponse.json({ snapshot: createQuotation(input), message: 'Quotation prepared as a demonstration draft.' });
    const generated = createReport(input);
    return NextResponse.json({ snapshot: generated.snapshot, report: generated.report, message: 'Draft demonstration report generated.' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to process action' }, { status: 400 });
  }
}
