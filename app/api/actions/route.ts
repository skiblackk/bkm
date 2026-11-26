import { NextResponse } from 'next/server';
import { createClient, updateClient, createQuotation, createReport, createTask, updateTask, setClientRelationship, setClientLogo, addServiceCharge, recordClientPayment, issueReceipt } from '@/lib/data-access';
import { z } from 'zod';
import { getDemoSession, requirePermission } from '@/lib/auth';
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
  z.object({ action: z.literal('setClientRelationship'), clientId: z.string().uuid(), relationship: z.enum(['serviced', 'vendor']) }),
  // A logo arrives as a data URI. There is no user-facing size limit: the panel
  // downscales large images before upload, and the 8 MB guard below exists only
  // to stop a malformed or hostile request writing an unbounded value into the
  // row. A real logo never comes close.
  z.object({ action: z.literal('setClientLogo'), clientId: z.string().uuid(), logoUrl: z.string().max(8_000_000).nullable() }),
  z.object({
    action: z.literal('addServiceCharge'),
    clientId: z.string().uuid(),
    serviceName: z.string().trim().min(2, 'Describe the service being paid for.'),
    description: z.string().optional(),
    direction: z.enum(['payable', 'receivable']),
    amount: z.number().positive('The amount must be greater than zero.'),
    currency: z.string().optional(),
    billingFrequency: z.enum(['one-off', 'weekly', 'monthly', 'quarterly', 'annual']).optional(),
    effectiveFrom: z.string().optional(),
  }),
  z.object({
    action: z.literal('recordClientPayment'),
    clientId: z.string().uuid(),
    chargeId: z.string().uuid().nullable().optional(),
    amount: z.number().positive('The payment amount must be greater than zero.'),
    currency: z.string().optional(),
    paidOn: z.string().optional(),
    method: z.string().optional(),
    reference: z.string().optional(),
    notes: z.string().optional(),
  }),
  z.object({ action: z.literal('issueReceipt'), paymentId: z.string().uuid(), notes: z.string().optional() }),
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

const CLIENT_PERMISSION = new Set(['createClient', 'updateClient', 'setClientStatus', 'createQuotation', 'setClientRelationship', 'setClientLogo', 'addServiceCharge', 'recordClientPayment', 'issueReceipt']);

/**
 * Cross-site request guard.
 *
 * These routes authenticate from a cookie, and a cross-site POST whose
 * Content-Type is text/plain, application/x-www-form-urlencoded or
 * multipart/form-data is a "simple" request: the browser sends it without a
 * preflight, so the attacker never needs CORS permission and the victim's
 * cookie rides along. Verified against production before this check existed —
 * a text/plain POST from another origin reached the handler and acted.
 *
 * The application itself only ever posts application/json, so requiring that
 * content type already stops every simple request. The Origin and Sec-Fetch-Site
 * checks are the second layer, for a browser that ignores the first.
 */
function crossSiteRequest(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return true;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });

    if (crossSiteRequest(request)) return NextResponse.json({ error: 'This request was not made from the application.' }, { status: 403 });

    const body = await request.json().catch(() => null);
    if (body === null) return NextResponse.json({ error: 'The request body was not valid JSON.' }, { status: 400 });

    // Authentication first (BKM-03). This route used to validate the body
    // before checking the session, so an unauthenticated caller could post a
    // deliberately malformed action and read back the exact field names and
    // enum vocabulary of a privileged write API from the 422. Two reads: a
    // cheap gate here, and the permission check below once the action is known.
    // Keeping both means an action added later that forgets its permission is
    // still behind a sign-in.
    const signedIn = await getDemoSession();
    if (!signedIn) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

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

    // The action-specific permission check. `session` above only proved the
    // caller is signed in; this proves they may perform this action.
    const actionSession = await requirePermission(CLIENT_PERMISSION.has(input.action) ? 'manage_clients' : input.action === 'createReport' ? 'view_finance' : 'manage_tasks');
    const actor = { id: actionSession.staffId ?? actionSession.account, name: actionSession.name, role: actionSession.role };

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
    if (input.action === 'setClientRelationship') {
      const snapshot = await setClientRelationship(input.clientId, input.relationship, actor);
      const noun = input.relationship === 'vendor' ? 'paid by BKM' : 'serviced by BKM';
      return NextResponse.json({ snapshot, message: `Record marked as ${noun}.` });
    }
    if (input.action === 'setClientLogo') {
      const snapshot = await setClientLogo(input.clientId, input.logoUrl, actor);
      return NextResponse.json({ snapshot, message: input.logoUrl ? 'Client logo saved.' : 'Client logo removed.' });
    }
    if (input.action === 'addServiceCharge') {
      const snapshot = await addServiceCharge(input, actor);
      return NextResponse.json({ snapshot, message: 'Service charge added to the record.' });
    }
    if (input.action === 'recordClientPayment') {
      const snapshot = await recordClientPayment(input, actor);
      return NextResponse.json({ snapshot, message: 'Payment recorded. A receipt can now be printed.' });
    }
    if (input.action === 'issueReceipt') {
      const result = await issueReceipt(input.paymentId, input.notes ?? '', actor);
      return NextResponse.json({ snapshot: result.snapshot, receipt: result.receipt, message: `Receipt ${result.receipt?.receiptNumber ?? ''} issued.` });
    }

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
