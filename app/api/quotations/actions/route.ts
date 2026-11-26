import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth';
import { isPermissionError } from '@/lib/permissions';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import { crossSiteRequest, blocked } from '../guard';
import {
  createQuotation, updateQuotation, getQuotation, listQuotations, setStatus,
  recordDecision, convertToInvoice, storeQuotationPdf, renderStoredPdf, snapshotRevision,
  sendQuotationEmail, recordShare, quotationMessage, documentInput, whatsappLink, whatsappNumber,
  expireLapsedQuotations,
} from '@/lib/quotation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const line = z.object({
  description: z.string().trim().min(1, 'Every line needs a description.').max(480),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
  discountPct: z.coerce.number().min(0).max(100).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
});

const draftFields = {
  clientId: z.string().uuid(),
  service: z.string().trim().min(2, 'Name the service being quoted.').max(160),
  description: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  lines: z.array(line).min(1, 'A quotation needs at least one line item.').max(40),
  validUntil: z.string().optional(),
  contactId: z.string().uuid().nullable().optional(),
  taxLabel: z.string().trim().max(24).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  paymentTerms: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  acceptanceInstructions: z.string().trim().max(2000).optional(),
};

// An update is a patch: a client may correct the notes without resending the
// whole builder payload, so nothing except the id is required here. The service
// merges the supplied fields over the stored draft.
const patchFields = {
  clientId: z.string().uuid().optional(),
  service: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  lines: z.array(line).min(1, 'A quotation needs at least one line item.').max(40).optional(),
  validUntil: z.string().optional(),
  contactId: z.string().uuid().nullable().optional(),
  taxLabel: z.string().trim().max(24).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  paymentTerms: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  acceptanceInstructions: z.string().trim().max(2000).optional(),
};

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ...draftFields }),
  z.object({ action: z.literal('update'), id: z.string().uuid(), ...patchFields }),
  z.object({ action: z.literal('issue'), id: z.string().uuid() }),
  z.object({ action: z.literal('markSent'), id: z.string().uuid(), channel: z.enum(['email', 'whatsapp', 'download', 'link', 'workspace']).optional() }),
  z.object({ action: z.literal('markViewed'), id: z.string().uuid() }),
  z.object({ action: z.literal('decide'), id: z.string().uuid(), decision: z.enum(['Accepted', 'Rejected']), decidedBy: z.string().trim().max(160).optional(), note: z.string().trim().max(1000).optional(), convert: z.boolean().optional() }),
  z.object({ action: z.literal('convert'), id: z.string().uuid() }),
  z.object({ action: z.literal('expireCheck') }),
  z.object({ action: z.literal('whatsapp'), id: z.string().uuid(), phone: z.string().trim().optional(), message: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('email'), id: z.string().uuid(), to: z.string().trim().email('Enter a valid client email address.'), subject: z.string().trim().max(200).optional(), body: z.string().trim().max(4000).optional() }),
]);

const PERMISSION: Record<string, string> = {
  create: 'create_quotations',
  update: 'edit_quotations',
  issue: 'issue_quotations',
  markSent: 'issue_quotations',
  markViewed: 'issue_quotations',
  expireCheck: 'issue_quotations',
  decide: 'record_quotation_decisions',
  convert: 'convert_quotations',
  whatsapp: 'share_quotations',
  email: 'share_quotations',
};

function friendly(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return { error: Object.values(fields)[0] ?? 'Please check the quotation details.', fields };
}

/** Response shape: the single quotation, the register, and a human message. */
async function payload(request: Request, id: string | null, message: string, extra: Record<string, unknown> = {}) {
  const [quotation, quotations] = await Promise.all([
    id ? getQuotation(id, request) : Promise.resolve(null),
    listQuotations(request),
  ]);
  return NextResponse.json({ quotation, quotations, message, ...extra });
}

export async function POST(request: Request) {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production repository is not configured.' }, { status: 503 });
    if (crossSiteRequest(request)) return blocked();

    const body = await request.json().catch(() => null);
    if (body === null) return NextResponse.json({ error: 'The request body was not valid JSON.' }, { status: 400 });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const known = typeof body?.action === 'string' && !/invalid_union_discriminator/.test(JSON.stringify(parsed.error.issues));
      if (!known) return NextResponse.json({ error: 'That action is not recognised.', fields: {} }, { status: 400 });
      return NextResponse.json(friendly(parsed.error), { status: 422 });
    }
    const input = parsed.data;
    const session = await requirePermission(PERMISSION[input.action] as never);
    const actor = { id: session.staffId ?? null, name: session.name };

    if (input.action === 'create') {
      const quotation = await createQuotation({ ...input, actor });
      return payload(request, quotation?.id ?? null, `Quotation ${quotation?.number ?? ''} prepared as a draft.`);
    }

    if (input.action === 'update') {
      const { action: _action, id: _id, ...patch } = input;
      const quotation = await updateQuotation(input.id, { ...patch, actor });
      return payload(request, input.id, `Quotation ${quotation?.number ?? ''} saved as revision ${quotation?.revision ?? 1}.`);
    }

    if (input.action === 'issue') {
      const current = await getQuotation(input.id, request);
      if (!current) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
      if (current.status !== 'Draft') {
        return NextResponse.json({ error: `This quotation is already ${current.status.toLowerCase()}.` }, { status: 409 });
      }
      const { buffer } = await renderStoredPdf(input.id, session.name);
      await storeQuotationPdf(current, buffer, actor);
      await snapshotRevision(current, actor, 'Issued');
      const quotation = await setStatus(input.id, 'Sent', actor, { channel: 'workspace', detail: 'Issued and stored as the delivered document.' });
      return payload(request, input.id, `Quotation ${current.number} issued and stored.`);
    }

    if (input.action === 'markSent') {
      const current = await getQuotation(input.id, request);
      if (!current) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
      if (current.status !== 'Draft') {
        return NextResponse.json({ error: `This quotation is already ${current.status.toLowerCase()}.` }, { status: 409 });
      }
      const { buffer } = await renderStoredPdf(input.id, session.name);
      await storeQuotationPdf(current, buffer, actor);
      await snapshotRevision(current, actor, 'Issued');
      const quotation = await setStatus(input.id, 'Sent', actor, { channel: input.channel ?? 'workspace' });
      return payload(request, input.id, `Quotation ${current.number} recorded as sent.`);
    }

    if (input.action === 'markViewed') {
      const quotation = await setStatus(input.id, 'Viewed', actor, { channel: 'workspace', detail: 'Client confirmed receipt of the quotation.' });
      return payload(request, input.id, 'Marked as viewed by the client.');
    }

    if (input.action === 'decide') {
      const result = await recordDecision(input.id, {
        decision: input.decision,
        decidedBy: input.decidedBy,
        note: input.note,
        convert: input.convert,
        actor,
      });
      const message = input.decision === 'Accepted'
        ? (result.invoiceNumber ? `Accepted, and invoice ${result.invoiceNumber} raised.` : 'Client acceptance recorded.')
        : 'Client rejection recorded. The quotation is preserved as issued.';
      return payload(request, input.id, message);
    }

    if (input.action === 'convert') {
      const result = await convertToInvoice(input.id, actor);
      return payload(request, input.id, `Invoice ${result.invoiceNumber} raised from the accepted quotation.`);
    }

    if (input.action === 'expireCheck') {
      const expired = await expireLapsedQuotations(actor);
      return NextResponse.json({ expired, quotations: await listQuotations(request), message: expired.length ? `${expired.length} quotation${expired.length === 1 ? '' : 's'} expired.` : 'No quotations have lapsed.' });
    }

    if (input.action === 'whatsapp') {
      const quotation = await getQuotation(input.id, request);
      if (!quotation) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
      if (quotation.status === 'Draft') {
        return NextResponse.json({ error: 'Issue the quotation before sending it to the client.' }, { status: 409 });
      }
      const message = input.message?.trim() || quotationMessage(documentInput(quotation, session.name), 'whatsapp');
      const phone = input.phone?.trim() || quotation.contactPhone;
      const link = whatsappLink(phone, message);
      await recordShare({
        quotationId: quotation.id, revision: quotation.revision, channel: 'whatsapp',
        recipient: phone || null, subject: quotation.number, body: message, reference: null, actor,
      });
      return payload(request, input.id, 'WhatsApp message prepared with the client number and text.', { whatsapp: { link, message, phone: whatsappNumber(phone), pdfUrl: `/api/quotations/pdf?id=${quotation.id}` } });
    }

    if (input.action === 'email') {
      const quotation = await getQuotation(input.id, request);
      if (!quotation) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
      if (quotation.status === 'Draft') {
        return NextResponse.json({ error: 'Issue the quotation before sending it to the client.' }, { status: 409 });
      }
      const { buffer, filename } = await renderStoredPdf(input.id, session.name);
      await storeQuotationPdf(quotation, buffer, actor);
      const sent = await sendQuotationEmail({
        quotation, pdf: buffer, filename,
        to: input.to, subject: input.subject, body: input.body,
        preparedBy: session.name, actor,
      });
      if (!sent.delivered) {
        return payload(request, input.id,
          'No email provider is configured, so the message was prepared and recorded rather than sent. Connect RESEND_API_KEY to deliver it automatically — or copy the text and attach the downloaded PDF.',
          { email: { delivered: false, to: input.to, subject: sent.subject, body: sent.message } });
      }
      return payload(request, input.id, `Quotation emailed to ${input.to} with the PDF attached.`, { email: { delivered: true, to: input.to, subject: sent.subject, id: sent.id } });
    }

    return NextResponse.json({ error: 'That action is not recognised.' }, { status: 400 });
  } catch (error) {
    if (isPermissionError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'The quotation action could not be completed.';
    const status = /not found/i.test(message) ? 404 : /cannot move|cannot be edited|already|must be issued|has not been issued|expired/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
