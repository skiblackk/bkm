/**
 * Quotation lifecycle: pricing, revisions, storage, delivery and conversion.
 *
 * Everything a client can see is derived here from stored rows — the browser is
 * never trusted to send a total. Two rules are load-bearing:
 *   - money is computed from quantity, unit price, discount and tax, and rounded
 *     once at the line level;
 *   - the content of an issued revision is snapshotted into quotation_revisions
 *     and its PDF into the private `quotations` bucket, so a later edit cannot
 *     change what the client already received.
 */

import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from './supabase/admin';
import { renderQuotationPdf, quotationMessage, type QuotationDocumentInput, type QuotationLine } from './quotation-pdf';

export const QUOTATION_STATUSES = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected', 'Expired'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** The only transitions the system will perform. Mirrored by a DB trigger. */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  Draft: ['Sent', 'Expired'],
  Sent: ['Viewed', 'Accepted', 'Rejected', 'Expired'],
  Viewed: ['Accepted', 'Rejected', 'Expired'],
  Accepted: [],
  Rejected: [],
  Expired: ['Sent', 'Viewed', 'Accepted', 'Rejected'],
};

export function canTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ISSUER = {
  name: 'BKM Associates',
  tagline: 'Audit  ·  Tax  ·  Advisory',
  addressLines: ['Westlands Business Park, 4th Floor', 'Waiyaki Way, Nairobi, Kenya'],
  email: 'quotes@bkma.co.ke',
  phone: '+254 20 271 8800',
  website: 'bkma.co.ke',
};

export type QuotationDraftLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
};

export type PricedLine = QuotationLine & { description: string };

export type PricedQuotation = {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
};

const round2 = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

/**
 * Price a quotation.
 *
 * Order matters and is stated once, here: discount applies to the line
 * subtotal, tax applies to what remains after the discount. The line total is
 * the only figure carried into the document, so the printed arithmetic always
 * adds up to the printed total.
 */
export function priceQuotation(
  rawLines: QuotationDraftLine[],
  options: { taxLabel?: string; taxRate?: number } = {},
): PricedQuotation {
  const fallbackTaxRate = Math.max(0, Math.min(100, Number(options.taxRate ?? 0)));
  const lines: PricedLine[] = rawLines
    .filter((line) => String(line.description ?? '').trim().length > 0)
    .map((line) => {
      const quantity = Math.max(0, Number(line.quantity ?? 0));
      const unitPrice = Math.max(0, Number(line.unitPrice ?? 0));
      const discountPct = Math.max(0, Math.min(100, Number(line.discountPct ?? 0)));
      const taxRate = line.taxRate === undefined || line.taxRate === null ? fallbackTaxRate : Math.max(0, Math.min(100, Number(line.taxRate)));
      const lineSubtotal = round2(quantity * unitPrice);
      const lineDiscount = round2(lineSubtotal * (discountPct / 100));
      const lineTax = round2((lineSubtotal - lineDiscount) * (taxRate / 100));
      const lineTotal = round2(lineSubtotal - lineDiscount + lineTax);
      return {
        description: String(line.description).trim().slice(0, 480),
        quantity,
        unitPrice: round2(unitPrice),
        discountPct,
        taxRate,
        lineSubtotal,
        lineDiscount,
        lineTax,
        lineTotal,
      };
    });

  return {
    lines,
    subtotal: round2(lines.reduce((sum, line) => sum + line.lineSubtotal, 0)),
    discountTotal: round2(lines.reduce((sum, line) => sum + line.lineDiscount, 0)),
    taxTotal: round2(lines.reduce((sum, line) => sum + line.lineTax, 0)),
    total: round2(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
  };
}

const money = (value: number) => new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(value);
const day = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
};
const stamp = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' })} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}`;
};
const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

function admin() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error('The production database is not configured.');
  return client;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data as T;
}

export type QuotationRecord = {
  id: string;
  number: string;
  revision: number;
  status: QuotationStatus;
  service: string;
  description: string;
  clientId: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  currency: string;
  issueDate: string;
  validUntil: string;
  subtotal: number;
  discountTotal: number;
  taxLabel: string;
  taxRate: number;
  taxTotal: number;
  total: number;
  paymentTerms: string;
  notes: string;
  acceptanceInstructions: string;
  lines: PricedLine[];
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  hasPdf: boolean;
  shareUrl: string;
  contacts: { id: string; name: string; email: string; phone: string }[];
  events: { from: string | null; to: string; channel: string; detail: string | null; actor: string | null; at: string; atLabel: string }[];
  shares: { channel: string; recipient: string | null; subject: string | null; at: string; atLabel: string; actor: string | null }[];
  invoice: { id: string; number: string; status: string; total: number; issueDate: string | null } | null;
  createdAt: string | null;
};

function siteOrigin(request?: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.BKM_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (request) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    if (host) return `${proto}://${host}`;
  }
  return 'https://bkm-livid.vercel.app';
}

export function shareLink(token: string, request?: Request) {
  return `${siteOrigin(request)}/quote/${token}`;
}

const statusTimestamp = (row: Record<string, unknown>) => {
  const status = String(row.status_enum ?? row.status ?? 'Draft');
  const source = status === 'Sent' ? row.sent_at
    : status === 'Viewed' ? row.viewed_at
    : status === 'Accepted' ? row.accepted_at
    : status === 'Rejected' ? row.rejected_at
    : status === 'Expired' ? row.expired_at
    : null;
  return stamp(source as string | null);
};

/** Every quotation with its lines, trail, deliveries and invoice link. */
export async function listQuotations(request?: Request): Promise<QuotationRecord[]> {
  const db = admin();
  const quotations = unwrap(await db.from('quotations')
    .select('*, clients(name, industry, location, contacts:client_contacts(id, full_name, email, phone, is_primary))')
    .is('deleted_at', null)
    .order('created_at', { ascending: false }), 'Quotations could not be read.');

  const ids = (quotations ?? []).map((row: Record<string, unknown>) => String(row.id));
  if (ids.length === 0) return [];

  const [items, events, shares, invoices, documents] = await Promise.all([
    db.from('quotation_items').select('*').in('quotation_id', ids).order('sort_order'),
    db.from('quotation_events').select('*').in('quotation_id', ids).order('occurred_at', { ascending: true }),
    db.from('quotation_shares').select('*').in('quotation_id', ids).order('created_at', { ascending: false }),
    db.from('invoices').select('id, invoice_number, status, total, issue_date, quotation_id').in('quotation_id', ids),
    db.from('quotation_documents').select('quotation_id, revision').in('quotation_id', ids),
  ]);

  const itemsBy = new Map<string, Record<string, unknown>[]>();
  for (const item of items.data ?? []) {
    const key = String(item.quotation_id);
    itemsBy.set(key, [...(itemsBy.get(key) ?? []), item]);
  }
  const eventsBy = new Map<string, Record<string, unknown>[]>();
  for (const event of events.data ?? []) {
    const key = String(event.quotation_id);
    eventsBy.set(key, [...(eventsBy.get(key) ?? []), event]);
  }
  const sharesBy = new Map<string, Record<string, unknown>[]>();
  for (const share of shares.data ?? []) {
    const key = String(share.quotation_id);
    sharesBy.set(key, [...(sharesBy.get(key) ?? []), share]);
  }
  const invoiceBy = new Map<string, Record<string, unknown>>();
  for (const invoice of invoices.data ?? []) invoiceBy.set(String(invoice.quotation_id), invoice);
  const pdfSet = new Set((documents.data ?? []).map((doc) => `${doc.quotation_id}:${doc.revision}`));

  return (quotations ?? []).map((row: Record<string, unknown>) => {
    const id = String(row.id);
    const client = (row.clients ?? {}) as Record<string, unknown>;
    const contacts = ((client.contacts ?? []) as Record<string, unknown>[]) ?? [];
    const primary = contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? {};
    const rawItems = itemsBy.get(id) ?? [];
    const lines: PricedLine[] = rawItems.map((item) => ({
      description: String(item.description ?? ''),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      discountPct: Number(item.discount_pct ?? 0),
      taxRate: Number(item.tax_rate ?? 0),
      lineSubtotal: Number(item.line_subtotal ?? 0),
      lineDiscount: Number(item.line_discount ?? 0),
      lineTax: Number(item.line_tax ?? 0),
      lineTotal: Number(item.line_total ?? 0),
    }));
    const revision = Number(row.revision ?? 1);
    const invoice = invoiceBy.get(id);

    return {
      id,
      number: String(row.quotation_number ?? '—'),
      revision,
      status: String(row.status_enum ?? row.status ?? 'Draft') as QuotationStatus,
      service: String(row.service_type ?? ''),
      description: String(row.description ?? ''),
      clientId: String(row.client_id),
      clientName: String(client.name ?? 'Client'),
      contactName: String(primary.full_name ?? ''),
      contactEmail: String(primary.email ?? ''),
      contactPhone: String(primary.phone ?? ''),
      currency: String(row.currency ?? 'KES'),
      issueDate: day(row.issue_date as string),
      validUntil: day(row.valid_until as string),
      subtotal: Number(row.subtotal ?? 0),
      discountTotal: Number(row.discount_total ?? 0),
      taxLabel: String(row.tax_label ?? 'VAT'),
      taxRate: Number(row.tax_rate ?? 0),
      taxTotal: Number(row.tax_total ?? 0),
      total: Number(row.total ?? 0),
      paymentTerms: String(row.payment_terms ?? ''),
      notes: String(row.notes ?? ''),
      acceptanceInstructions: String(row.acceptance_instructions ?? ''),
      lines,
      sentAt: stamp(row.sent_at as string | null),
      viewedAt: stamp(row.viewed_at as string | null),
      acceptedAt: stamp(row.accepted_at as string | null),
      rejectedAt: stamp(row.rejected_at as string | null),
      expiredAt: stamp(row.expired_at as string | null),
      decidedBy: (row.decided_by_name as string) ?? null,
      decisionNote: (row.decision_note as string) ?? null,
      hasPdf: pdfSet.has(`${id}:${revision}`),
      shareUrl: shareLink(String(row.public_token), request),
      contacts: contacts.map((contact) => ({
        id: String(contact.id),
        name: String(contact.full_name ?? ''),
        email: String(contact.email ?? ''),
        phone: String(contact.phone ?? ''),
      })),
      events: (eventsBy.get(id) ?? []).map((event) => ({
        from: (event.from_status as string) ?? null,
        to: String(event.to_status),
        channel: String(event.channel ?? 'workspace'),
        detail: (event.detail as string) ?? null,
        actor: (event.actor_name as string) ?? null,
        at: String(event.occurred_at),
        atLabel: stamp(event.occurred_at as string) ?? '—',
      })),
      shares: (sharesBy.get(id) ?? []).map((share) => ({
        channel: String(share.channel),
        recipient: (share.recipient as string) ?? null,
        subject: (share.subject as string) ?? null,
        at: String(share.created_at),
        atLabel: stamp(share.created_at as string) ?? '—',
        actor: (share.actor_name as string) ?? null,
      })),
      invoice: invoice ? {
        id: String(invoice.id),
        number: String(invoice.invoice_number),
        status: String(invoice.status),
        total: Number(invoice.total ?? 0),
        issueDate: invoice.issue_date ? day(invoice.issue_date as string) : null,
      } : null,
      createdAt: row.created_at ? String(row.created_at) : null,
      // statusTimestamp kept for the compact list view
      ...({ statusChangedAt: statusTimestamp(row) } as Record<string, unknown>),
    } as QuotationRecord;
  });
}

export async function getQuotation(id: string, request?: Request): Promise<QuotationRecord | null> {
  const all = await listQuotations(request);
  return all.find((quotation) => quotation.id === id) ?? null;
}

/** The renderer input for a record, shared by download, email and WhatsApp. */
export function documentInput(quotation: QuotationRecord, preparedBy: string): QuotationDocumentInput {
  return {
    issuer: ISSUER,
    quotation: {
      number: quotation.number,
      revision: quotation.revision,
      issueDate: quotation.issueDate,
      validUntil: quotation.validUntil,
      currency: quotation.currency,
      service: quotation.service,
      description: quotation.description,
      subtotal: quotation.subtotal,
      discountTotal: quotation.discountTotal,
      taxLabel: quotation.taxLabel,
      taxRate: quotation.taxRate,
      taxTotal: quotation.taxTotal,
      total: quotation.total,
      paymentTerms: quotation.paymentTerms,
      notes: quotation.notes,
      acceptanceInstructions: quotation.acceptanceInstructions,
      preparedBy,
    },
    client: {
      company: quotation.clientName,
      contactName: quotation.contactName,
      contactEmail: quotation.contactEmail,
      contactPhone: quotation.contactPhone,
      location: '',
      industry: '',
    },
    lines: quotation.lines,
  };
}

export async function renderStoredPdf(id: string, preparedBy: string): Promise<{ buffer: Buffer; filename: string; quotation: QuotationRecord }> {
  const quotation = await getQuotation(id);
  if (!quotation) throw new Error('Quotation not found.');
  const buffer = await renderQuotationPdf(documentInput(quotation, preparedBy));
  return { buffer, filename: `${quotation.number}-rev${quotation.revision}.pdf`, quotation };
}

/**
 * Store the PDF for a quotation revision in the private bucket and record it.
 * Idempotent: re-issuing the same revision replaces the object and the row.
 */
export async function storeQuotationPdf(quotation: QuotationRecord, buffer: Buffer, actor: { id: string | null; name: string }) {
  const db = admin();
  const path = `${quotation.id}/rev-${quotation.revision}.pdf`;
  const filename = `${quotation.number}-rev${quotation.revision}.pdf`;

  const upload = await db.storage.from('quotations').upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upload.error) throw new Error(`The quotation PDF could not be stored: ${upload.error.message}`);

  const digest = createHash('sha256').update(buffer).digest('hex');
  const record = await db.from('quotation_documents').upsert({
    quotation_id: quotation.id,
    revision: quotation.revision,
    storage_path: path,
    filename,
    content_type: 'application/pdf',
    byte_size: buffer.length,
    sha256: digest,
    generated_by: actor.id,
  }, { onConflict: 'quotation_id,revision' });
  if (record.error) throw new Error(`The quotation document record could not be saved: ${record.error.message}`);

  return { path, filename, digest, byteSize: buffer.length };
}

/** Download the stored bytes, or render and store them if the object is missing. */
export async function quotationPdfBytes(quotation: QuotationRecord, preparedBy: string, actor: { id: string | null; name: string }) {
  const db = admin();
  const path = `${quotation.id}/rev-${quotation.revision}.pdf`;
  const stored = await db.storage.from('quotations').download(path);
  if (stored.data && !stored.error) {
    const arrayBuffer = await stored.data.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), filename: `${quotation.number}-rev${quotation.revision}.pdf`, generated: false };
  }
  const buffer = await renderQuotationPdf(documentInput(quotation, preparedBy));
  await storeQuotationPdf(quotation, buffer, actor);
  return { buffer, filename: `${quotation.number}-rev${quotation.revision}.pdf`, generated: true };
}

/** Snapshot the issued content so later edits cannot rewrite history. */
export async function snapshotRevision(quotation: QuotationRecord, actor: { id: string | null; name: string }, reason: string) {
  const db = admin();
  const snapshot = {
    quotationNumber: quotation.number,
    revision: quotation.revision,
    issuedAt: new Date().toISOString(),
    service: quotation.service,
    description: quotation.description,
    currency: quotation.currency,
    issueDate: quotation.issueDate,
    validUntil: quotation.validUntil,
    subtotal: quotation.subtotal,
    discountTotal: quotation.discountTotal,
    taxLabel: quotation.taxLabel,
    taxRate: quotation.taxRate,
    taxTotal: quotation.taxTotal,
    total: quotation.total,
    paymentTerms: quotation.paymentTerms,
    notes: quotation.notes,
    acceptanceInstructions: quotation.acceptanceInstructions,
    client: { id: quotation.clientId, name: quotation.clientName, contact: quotation.contactName, email: quotation.contactEmail, phone: quotation.contactPhone },
    lines: quotation.lines,
  };
  // A revision snapshot is written once and never touched again — the table
  // trigger rejects updates, so use insert and treat a duplicate as "already
  // snapshotted".
  const result = await db.from('quotation_revisions').insert({
    quotation_id: quotation.id,
    revision: quotation.revision,
    snapshot,
    subtotal: quotation.subtotal,
    discount_total: quotation.discountTotal,
    tax_total: quotation.taxTotal,
    total: quotation.total,
    currency: quotation.currency,
    reason,
    created_by: actor.id,
    created_by_name: actor.name,
  });
  if (result.error && result.error.code !== '23505' && !/duplicate key/i.test(result.error.message)) {
    throw new Error(`The issued revision could not be recorded: ${result.error.message}`);
  }
}

export async function recordShare(input: {
  quotationId: string;
  revision: number;
  channel: 'email' | 'whatsapp' | 'download' | 'link';
  recipient?: string | null;
  subject?: string | null;
  body?: string | null;
  reference?: string | null;
  actor: { id: string | null; name: string };
}) {
  const db = admin();
  const result = await db.from('quotation_shares').insert({
    quotation_id: input.quotationId,
    revision: input.revision,
    channel: input.channel,
    recipient: input.recipient ?? null,
    subject: input.subject ?? null,
    body: input.body ? input.body.slice(0, 4000) : null,
    reference: input.reference ?? null,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
  });
  if (result.error) throw new Error(`The delivery record could not be saved: ${result.error.message}`);
}

export async function appendEvent(input: {
  quotationId: string;
  from?: string | null;
  to: string;
  channel?: string;
  detail?: string | null;
  actor?: { id: string | null; name: string };
}) {
  const db = admin();
  await db.from('quotation_events').insert({
    quotation_id: input.quotationId,
    from_status: input.from ?? null,
    to_status: input.to,
    channel: input.channel ?? 'workspace',
    detail: input.detail ?? null,
    actor_id: input.actor?.id ?? null,
    actor_name: input.actor?.name ?? null,
  });
}

/**
 * Move a quotation to a new status after checking the transition rules.
 * The database enforces the same rules; this gives the caller a clear message.
 */
export async function setStatus(
  id: string,
  next: QuotationStatus,
  actor: { id: string | null; name: string },
  options: { channel?: string; detail?: string | null; decidedBy?: string; note?: string | null } = {},
) {
  const current = await getQuotation(id);
  if (!current) throw new Error('Quotation not found.');
  if (current.status === next) return current;
  if (!canTransition(current.status, next)) {
    throw new Error(`A quotation cannot move from ${current.status} to ${next}.`);
  }
  const db = admin();
  const patch: Record<string, unknown> = { status_enum: next, status: next };
  if (next === 'Accepted') {
    patch.decided_by_name = options.decidedBy ?? current.decidedBy ?? current.contactName ?? null;
    patch.decision_note = options.note ?? null;
    patch.accepted_by = actor.id;
  }
  if (next === 'Rejected') {
    patch.decided_by_name = options.decidedBy ?? current.decidedBy ?? current.contactName ?? null;
    patch.decision_note = options.note ?? null;
  }
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
  const result = await db.from('quotations').update(patch).eq('id', id);
  if (result.error) throw new Error(result.error.message);

  // The trigger already wrote the dated event the moment the status changed.
  // Annotate exactly that row — never a wildcard match, so older rows from the
  // same transition are left alone.
  const logged = await db.from('quotation_events')
    .select('id')
    .eq('quotation_id', id)
    .eq('to_status', next)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logged.data?.id) {
    await db.from('quotation_events').update({
      channel: options.channel ?? 'workspace',
      detail: options.detail ?? null,
      actor_id: actor.id,
      actor_name: actor.name,
    }).eq('id', logged.data.id);
  }
  return getQuotation(id);
}

export async function createQuotation(input: {
  clientId: string;
  service: string;
  description?: string;
  terms?: string;
  lines: QuotationDraftLine[];
  validUntil?: string;
  contactId?: string | null;
  taxLabel?: string;
  taxRate?: number;
  paymentTerms?: string;
  notes?: string;
  acceptanceInstructions?: string;
  actor: { id: string | null; name: string };
}) {
  const db = admin();
  const priced = priceQuotation(input.lines, { taxLabel: input.taxLabel, taxRate: input.taxRate });
  if (priced.lines.length === 0) throw new Error('A quotation needs at least one line item.');

  // Retry on the unique constraint rather than trusting a read-then-write race.
  let created: Record<string, unknown> | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    const numberResult = await db.rpc('next_quotation_number');
    const number = (numberResult.data as string) ?? null;
    if (!number) throw new Error('A quotation number could not be allocated.');
    const insert = await db.from('quotations').insert({
      client_id: input.clientId,
      quotation_number: number,
      service_type: input.service,
      description: input.description ?? '',
      terms: input.terms ?? '',
      status: 'Draft',
      status_enum: 'Draft',
      issue_date: today(),
      valid_until: input.validUntil || addDays(today(), 30),
      currency: 'KES',
      subtotal: priced.subtotal,
      discount_total: priced.discountTotal,
      tax_label: input.taxLabel ?? 'VAT',
      tax_rate: input.taxRate ?? 0,
      tax_total: priced.taxTotal,
      total: priced.total,
      payment_terms: input.paymentTerms ?? 'Payable within 30 days of invoice. Bank transfer or cheque in favour of BKM Associates.',
      notes: input.notes ?? 'All amounts are quoted in Kenyan Shillings. Fees exclude disbursements unless stated.',
      acceptance_instructions: input.acceptanceInstructions ?? 'Accept online using the secure link sent with this quotation, or sign and return the acceptance strip on the PDF. Both record the date, time and name on our system.',
      contact_id: input.contactId ?? null,
      created_by: input.actor.id,
      revision: 1,
    }).select('id').single();
    if (insert.error) {
      lastError = insert.error.message;
      if (!/duplicate key|unique/i.test(insert.error.message)) {
        throw new Error(`The quotation could not be created: ${insert.error.message}`);
      }
      continue;
    }
    created = insert.data as Record<string, unknown>;
  }
  if (!created) throw new Error(`The quotation number could not be made unique. ${lastError}`);

  const id = String(created.id);
  const items = priced.lines.map((line, index) => ({
    quotation_id: id,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    discount_pct: line.discountPct,
    tax_rate: line.taxRate,
    line_subtotal: line.lineSubtotal,
    line_discount: line.lineDiscount,
    line_tax: line.lineTax,
    line_total: line.lineTotal,
    sort_order: index,
  }));
  const itemInsert = await db.from('quotation_items').insert(items);
  if (itemInsert.error) throw new Error(`The quotation lines could not be saved: ${itemInsert.error.message}`);

  await appendEvent({ quotationId: id, to: 'Draft', channel: 'workspace', detail: 'Quotation prepared.', actor: input.actor });
  return getQuotation(id);
}

/**
 * Edit a draft. Once a quotation has been issued, editing it issues a new
 * revision: the previous content and PDF stay exactly as the client received them.
 */
export async function updateQuotation(id: string, input: {
  clientId?: string;
  service?: string;
  description?: string;
  terms?: string;
  lines?: QuotationDraftLine[];
  validUntil?: string;
  contactId?: string | null;
  taxRate?: number;
  paymentTerms?: string;
  notes?: string;
  acceptanceInstructions?: string;
  actor: { id: string | null; name: string };
}) {
  const current = await getQuotation(id);
  if (!current) throw new Error('Quotation not found.');
  if (current.status === 'Accepted' || current.status === 'Rejected') {
    throw new Error(`This quotation is ${current.status.toLowerCase()} and can no longer be edited. Raise a new quotation for further work.`);
  }
  const db = admin();
  const priced = priceQuotation(input.lines ?? current.lines, { taxRate: input.taxRate ?? current.taxRate });
  if (priced.lines.length === 0) throw new Error('A quotation needs at least one line item.');

  const issued = current.status !== 'Draft';
  const nextRevision = issued ? current.revision + 1 : current.revision;

  const patch: Record<string, unknown> = {
    client_id: input.clientId ?? current.clientId,
    service_type: input.service ?? current.service,
    description: input.description ?? current.description,
    terms: input.terms ?? current.paymentTerms,
    valid_until: input.validUntil ?? current.validUntil,
    subtotal: priced.subtotal,
    discount_total: priced.discountTotal,
    tax_rate: input.taxRate ?? current.taxRate,
    tax_total: priced.taxTotal,
    total: priced.total,
    payment_terms: input.paymentTerms ?? current.paymentTerms,
    notes: input.notes ?? current.notes,
    acceptance_instructions: input.acceptanceInstructions ?? current.acceptanceInstructions,
    contact_id: input.contactId === undefined ? undefined : input.contactId,
    revision: nextRevision,
  };
  if (issued) {
    // A new revision goes back to Draft for issue; it is a new document to send.
    patch.status_enum = 'Draft';
    patch.status = 'Draft';
    patch.sent_at = null;
    patch.viewed_at = null;
    patch.issue_date = today();
  }
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
  const result = await db.from('quotations').update(patch).eq('id', id);
  if (result.error) throw new Error(result.error.message);

  const remove = await db.from('quotation_items').delete().eq('quotation_id', id);
  if (remove.error) throw new Error(remove.error.message);
  const insert = await db.from('quotation_items').insert(priced.lines.map((line, index) => ({
    quotation_id: id,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    discount_pct: line.discountPct,
    tax_rate: line.taxRate,
    line_subtotal: line.lineSubtotal,
    line_discount: line.lineDiscount,
    line_tax: line.lineTax,
    line_total: line.lineTotal,
    sort_order: index,
  })));
  if (insert.error) throw new Error(insert.error.message);

  await appendEvent({
    quotationId: id,
    from: current.status,
    to: issued ? 'Draft' : current.status,
    channel: 'workspace',
    detail: issued ? `Revised as revision ${nextRevision}; revision ${current.revision} remains on file as issued.` : 'Draft updated.',
    actor: input.actor,
  });

  return getQuotation(id);
}

/** Mark issued quotations whose validity has lapsed. Run on load and by cron. */
export async function expireLapsedQuotations(actor: { id: string | null; name: string }) {
  const db = admin();
  const lapsed = await db.from('quotations')
    .select('id')
    .in('status_enum', ['Sent', 'Viewed'])
    .lt('valid_until', today())
    .is('deleted_at', null);
  const expired: string[] = [];
  for (const row of lapsed.data ?? []) {
    try {
      await setStatus(String(row.id), 'Expired', actor, { channel: 'system', detail: 'Validity date passed without a client decision.' });
      expired.push(String(row.id));
    } catch {
      // A concurrent change of status is not an error worth surfacing.
    }
  }
  return expired;
}

/** A client's decision, recorded by a person and attributed to them and the client. */
export async function recordDecision(id: string, input: {
  decision: 'Accepted' | 'Rejected';
  decidedBy?: string;
  note?: string;
  convert?: boolean;
  channel?: string;
  actor: { id: string | null; name: string };
}) {
  const current = await getQuotation(id);
  if (!current) throw new Error('Quotation not found.');
  if (current.status === input.decision) return { quotation: current, invoiceNumber: current.invoice?.number ?? null };

  let quotation = current;
  if (quotation.status === 'Draft') {
    throw new Error('A draft quotation has not been issued. Send it before recording a client decision.');
  }
  if (quotation.status === 'Expired') {
    throw new Error(`This quotation expired on ${quotation.validUntil}. Reissue it as a new revision before recording a decision.`);
  }
  const db = admin();
  const patch: Record<string, unknown> = {
    status_enum: input.decision,
    status: input.decision,
    decided_by_name: input.decidedBy?.trim() || quotation.contactName || quotation.decidedBy || null,
    decision_note: input.note?.trim() || null,
  };
  if (input.decision === 'Accepted') patch.accepted_by = input.actor.id;
  const moved = await db.from('quotations').update(patch).eq('id', id);
  if (moved.error) {
    if (/cannot move/i.test(moved.error.message)) throw new Error(moved.error.message);
    throw new Error(`The decision could not be recorded: ${moved.error.message}`);
  }
  const logged = await db.from('quotation_events')
    .select('id')
    .eq('quotation_id', id)
    .eq('to_status', input.decision)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logged.data?.id) {
    await db.from('quotation_events').update({
      channel: input.channel ?? 'workspace',
      detail: input.note?.trim() || null,
      actor_id: input.actor.id,
      actor_name: input.actor.name,
    }).eq('id', logged.data.id);
  }
  quotation = (await getQuotation(id)) ?? quotation;

  if (input.decision === 'Accepted' && input.convert) {
    const converted = await convertToInvoice(id, input.actor, quotation);
    return converted;
  }
  return { quotation, invoiceNumber: quotation.invoice?.number ?? null };
}

/**
 * Convert an accepted quotation to an invoice.
 *
 * The database function does the quotation status change and the invoice insert
 * in one transaction, so a quotation can never end up accepted without its
 * invoice, or an invoice without the acceptance that justified it.
 */
export async function convertToInvoice(id: string, actor: { id: string | null; name: string }, existing?: QuotationRecord) {
  const quotation = existing ?? await getQuotation(id);
  if (!quotation) throw new Error('Quotation not found.');
  if (quotation.status !== 'Accepted') {
    throw new Error('Only an accepted quotation can be converted to an invoice.');
  }
  if (quotation.invoice) {
    return { quotation, invoiceNumber: quotation.invoice.number, alreadyConverted: true };
  }
  const db = admin();
  const result = await db.rpc('quotation_accept', {
    p_quotation_id: quotation.id,
    p_actor: actor.id,
    p_actor_name: actor.name,
    p_decided_by: quotation.decidedBy ?? quotation.contactName,
    p_note: quotation.decisionNote,
    p_create_invoice: true,
  });
  if (result.error) throw new Error(`The invoice could not be raised: ${result.error.message}`);
  const updated = await getQuotation(id);
  return { quotation: updated ?? quotation, invoiceNumber: (result.data as { invoice_number?: string })?.invoice_number ?? updated?.invoice?.number ?? null, alreadyConverted: false };
}

export type EmailProvider = 'resend' | 'console';

export function emailProvider(): { provider: EmailProvider; from: string } {
  if (process.env.RESEND_API_KEY) {
    return { provider: 'resend', from: process.env.BKM_QUOTE_FROM_EMAIL || 'BKM Associates <quotes@bkma.co.ke>' };
  }
  return { provider: 'console', from: process.env.BKM_QUOTE_FROM_EMAIL || 'quotes@bkma.co.ke' };
}

/**
 * Send the quotation as an email with the PDF attached.
 *
 * With RESEND_API_KEY configured the message is delivered for real. Without it
 * the delivery is recorded as a prepared draft rather than pretending to have
 * been sent — the caller reports that honestly to the person clicking Send.
 */
export async function sendQuotationEmail(input: {
  quotation: QuotationRecord;
  pdf: Buffer;
  filename: string;
  to: string;
  subject?: string;
  body?: string;
  preparedBy: string;
  actor: { id: string | null; name: string };
}) {
  const { provider, from } = emailProvider();
  const message = input.body?.trim() || quotationMessage(documentInput(input.quotation, input.preparedBy), 'email');
  const subject = input.subject?.trim() || `Quotation ${input.quotation.number} — ${input.quotation.service}`;

  if (provider === 'console') {
    await recordShare({
      quotationId: input.quotation.id,
      revision: input.quotation.revision,
      channel: 'email',
      recipient: input.to,
      subject,
      body: message,
      reference: 'draft-not-sent',
      actor: input.actor,
    });
    return { delivered: false, provider, subject, message, id: null as string | null };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject,
      text: message,
      attachments: [{ filename: input.filename, content: input.pdf.toString('base64') }],
    }),
  });
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const detail = (payload as { message?: string }).message ?? `Email provider returned ${response.status}.`;
    throw new Error(detail);
  }
  const id = (payload as { id?: string }).id ?? null;
  await recordShare({
    quotationId: input.quotation.id,
    revision: input.quotation.revision,
    channel: 'email',
    recipient: input.to,
    subject,
    body: message,
    reference: id,
    actor: input.actor,
  });
  return { delivered: true, provider, subject, message, id };
}

/** Normalise a Kenyan number to the international form WhatsApp expects. */
export function whatsappNumber(raw: string): string {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits.slice(1);
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

export function whatsappLink(rawNumber: string, message: string) {
  const number = whatsappNumber(rawNumber);
  const text = encodeURIComponent(message);
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** The public, signed-out view of a quotation. Read-only, by token. */
export async function getPublicQuotation(token: string, options: { markViewed?: boolean } = {}) {
  const db = admin();
  const result = await db.from('quotations')
    .select('*, clients(name, industry, location, contacts:client_contacts(full_name, email, phone, is_primary))')
    .eq('public_token', token)
    .is('deleted_at', null)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as Record<string, unknown>;
  const client = (row.clients ?? {}) as Record<string, unknown>;
  const contacts = ((client.contacts ?? []) as Record<string, unknown>[]) ?? [];
  const primary = contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? {};
  const items = await db.from('quotation_items').select('*').eq('quotation_id', row.id).order('sort_order');

  // Viewing the document is the signal that the client opened it. The status
  // trigger writes the dated event; this only annotates it with the channel the
  // client actually used.
  const markViewed = options.markViewed !== false;
  if (markViewed && String(row.status_enum) === 'Sent') {
    const moved = await db.from('quotations').update({ status_enum: 'Viewed', status: 'Viewed' }).eq('id', row.id);
    if (!moved.error) {
      const logged = await db.from('quotation_events')
        .select('id').eq('quotation_id', row.id).eq('to_status', 'Viewed')
        .order('occurred_at', { ascending: false }).limit(1).maybeSingle();
      if (logged.data?.id) {
        await db.from('quotation_events').update({
          channel: 'link',
          detail: 'Quotation opened through its shared link by the client.',
        }).eq('id', logged.data.id);
      }
      row.status_enum = 'Viewed';
    }
  }

  return {
    id: String(row.id),
    number: String(row.quotation_number ?? ''),
    revision: Number(row.revision ?? 1),
    status: String(row.status_enum ?? 'Sent'),
    service: String(row.service_type ?? ''),
    description: String(row.description ?? ''),
    clientName: String(client.name ?? ''),
    contactName: String(primary.full_name ?? ''),
    issueDate: day(row.issue_date as string),
    validUntil: day(row.valid_until as string),
    currency: String(row.currency ?? 'KES'),
    subtotal: Number(row.subtotal ?? 0),
    discountTotal: Number(row.discount_total ?? 0),
    taxLabel: String(row.tax_label ?? 'VAT'),
    taxRate: Number(row.tax_rate ?? 0),
    taxTotal: Number(row.tax_total ?? 0),
    total: Number(row.total ?? 0),
    paymentTerms: String(row.payment_terms ?? ''),
    notes: String(row.notes ?? ''),
    acceptanceInstructions: String(row.acceptance_instructions ?? ''),
    lines: (items.data ?? []).map((item) => ({
      description: String(item.description ?? ''),
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      lineTotal: Number(item.line_total ?? 0),
    })),
  };
}

export { money, day as formatDay, stamp as formatStamp };
export { renderQuotationPdf, quotationMessage } from './quotation-pdf';
export type { QuotationDocumentInput } from './quotation-pdf';
