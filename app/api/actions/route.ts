import { NextResponse } from 'next/server';
import { createClient, updateClient, createQuotation, createReport, createTask, updateTask } from '@/lib/data-access';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth';
import { isPermissionError } from '@/lib/permissions';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';

const clientFields = {
  name: z.string().trim().min(2, 'Organisation name is required.'),
  industry: z.string().trim().min(2, 'Industry is required.'),
  location: z.string().trim().min(2, 'Location is required.'),
  contactName: z.string().trim().min(2, 'Primary contact name is required.'),
  contactEmail: z.string().trim().email('Enter a valid contact email address.'),
  contactPhone: z.string().trim().optional(),
  description: z.string().trim().optional(),
};

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('updateTask'), taskId: z.string(), status: z.enum(['Not Started', 'In Progress', 'Blocked', 'Submitted', 'Under Review', 'Completed']).optional(), assignedTo: z.string().optional() }),
  z.object({ action: z.literal('createTask'), title: z.string().trim().min(2), description: z.string().optional(), clientId: z.string().optional(), engagementId: z.string().optional(), assignedTo: z.string().optional(), priority: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(), dueDate: z.string().optional() }),
  z.object({ action: z.literal('createClient'), ...clientFields }),
  z.object({ action: z.literal('updateClient'), clientId: z.string().uuid(), ...clientFields }),
  z.object({
    action: z.literal('setClientStatus'),
    clientId: z.string().uuid(),
    status: z.enum(['Active', 'On hold', 'Archived']),
  }),
  z.object({ action: z.literal('createQuotation'), clientId: z.string(), service: z.string(), description: z.string(), terms: z.string(), items: z.array(z.object({ id: z.string(), description: z.string(), quantity: z.number(), unitPrice: z.number() })) }),
  z.object({ action: z.literal('createReport'), clientId: z.string(), engagementId: z.string(), reportType: z.string() }),
]);

/**
 * Turn a validator failure into something a person can act on.
 * Previously the raw ZodError array was stringified into the red banner.
 */
function friendlyValidationError(error: z.ZodError): { error: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !fields[key]) fields[key] = issue.message;
  }
  const first = Object.values(fields)[0] ?? 'Please check the highlighted fields.';
  return { error: first, fields };
}

const CLIENT_PERMISSION = new Set(['createClient', 'updateClient', 'setClientStatus', 'createQuotation']);

export async function POST(request: Request) {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });

    const body = await request.json().catch(() => null);
    if (body === null) return NextResponse.json({ error: 'The request body was not valid JSON.' }, { status: 400 });

    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      // An unknown action is a bad request. A known action with bad fields is a
      // validation failure and must say which field is wrong and why, in words.
      const known = typeof (body as { action?: unknown })?.action === 'string'
        && (body as { action: string }).action !== ''
        && !/invalid_union_discriminator/.test(JSON.stringify(parsed.error.issues));
      if (!known) {
        return NextResponse.json({ error: 'That action is not recognised or is missing required information.', fields: {} }, { status: 400 });
      }
      const friendly = friendlyValidationError(parsed.error);
      return NextResponse.json(friendly, { status: 422 });
    }
    const input = parsed.data;

    const session = await requirePermission(CLIENT_PERMISSION.has(input.action) ? 'manage_clients' : input.action === 'createReport' ? 'view_finance' : 'manage_tasks');
    const actor = { id: session.staffId ?? session.account, name: session.name, role: session.role };

    if (input.action === 'createTask') return NextResponse.json({ snapshot: await createTask(input), message: 'Task created in the live workspace.' });
    if (input.action === 'updateTask') {
      const snapshot = await updateTask(input.taskId, { status: input.status, assignedTo: input.assignedTo });
      if (!snapshot) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      return NextResponse.json({ snapshot, message: 'Task updated in the live workspace.' });
    }
    if (input.action === 'createClient') {
      const snapshot = await createClient(input, actor);
      return NextResponse.json({ snapshot, message: 'Client added to the portfolio.' });
    }
    if (input.action === 'updateClient') {
      const snapshot = await updateClient(input.clientId, {
        name: input.name, industry: input.industry, location: input.location,
        description: input.description, contactName: input.contactName,
        contactEmail: input.contactEmail, contactPhone: input.contactPhone,
      }, actor);
      return NextResponse.json({ snapshot, message: 'Client details updated.' });
    }
    if (input.action === 'setClientStatus') {
      const snapshot = await updateClient(input.clientId, { status: input.status }, actor);
      const message = input.status === 'Archived' ? 'Client archived.' : `Client moved to ${input.status.toLowerCase()}.`;
      return NextResponse.json({ snapshot, message });
    }
    if (input.action === 'createQuotation') return NextResponse.json({ snapshot: await createQuotation(input), message: 'Quotation prepared as a draft.' });

    const generated = await createReport(input);
    return NextResponse.json({ snapshot: generated.snapshot, report: generated.report, message: 'Draft report generated.' });
  } catch (error) {
    // Validation problems that survive the schema check carry their own message.
    if (error instanceof z.ZodError) {
      const friendly = friendlyValidationError(error);
      return NextResponse.json(friendly, { status: 422 });
    }
    // Permission failures carry a real status (401 / 403); honour it instead of
    // flattening every refusal into a 400 bad request.
    if (isPermissionError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Unable to process action';
    // Known business-rule conflicts get a meaningful status too.
    const status = /already exists/i.test(message) ? 409 : /not found/i.test(message) ? 404 : /required/i.test(message) ? 422 : 400;
    return NextResponse.json({ error: friendlyMessage(message) }, { status });
  }
}

/** Strip database plumbing from messages so users never see column/type internals. */
function friendlyMessage(message: string): string {
  if (/duplicate key/i.test(message) && /clients_name_unique|lower/i.test(message)) {
    return 'A client with this name already exists. Open the existing record instead of creating a duplicate.';
  }
  if (/duplicate key/i.test(message) && /email/i.test(message)) {
    return 'A client contact with this email already exists. Check the existing client record before continuing.';
  }
  if (/invalid input syntax for type uuid/i.test(message)) {
    return 'The record reference was not valid. Refresh the page and try again.';
  }
  return message;
}
