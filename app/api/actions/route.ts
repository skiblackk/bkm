import { NextResponse } from 'next/server';
import { createQuotation, createReport, updateTask } from '@/lib/repository';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('updateTask'), taskId: z.string(), status: z.enum(['Not Started', 'In Progress', 'Blocked', 'Submitted', 'Under Review', 'Completed']).optional(), assignedTo: z.string().optional() }),
  z.object({ action: z.literal('createQuotation'), clientId: z.string(), service: z.string(), description: z.string(), terms: z.string(), items: z.array(z.object({ id: z.string(), description: z.string(), quantity: z.number(), unitPrice: z.number() })) }),
  z.object({ action: z.literal('createReport'), clientId: z.string(), engagementId: z.string(), reportType: z.string() }),
]);

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    await requirePermission(input.action === 'createQuotation' ? 'manage_clients' : input.action === 'createReport' ? 'view_finance' : 'manage_tasks');
    if (input.action === 'updateTask') {
      const snapshot = updateTask(input.taskId, { status: input.status, assignedTo: input.assignedTo });
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
