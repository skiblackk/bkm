/**
 * Client-facing quotation document.
 *
 * Rendered with pdfkit on the server so the file a client receives is produced
 * by the same system that holds the record — not by a browser print dialog,
 * which is how a quotation and its stored number drift apart.
 *
 * Layout is drawn on a fixed grid rather than a flowing document: the issuer
 * block, the totals panel and the acceptance strip are always in the same
 * place, so a quotation reads identically whether it has one line or twelve.
 */

import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type QuotationLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTax: number;
  lineTotal: number;
};

export type QuotationDocumentInput = {
  issuer: {
    name: string;
    tagline: string;
    addressLines: string[];
    email: string;
    phone: string;
    website: string;
    pin?: string;
  };
  quotation: {
    number: string;
    revision: number;
    issueDate: string;
    validUntil: string;
    currency: string;
    service: string;
    description: string;
    subtotal: number;
    discountTotal: number;
    taxLabel: string;
    taxRate: number;
    taxTotal: number;
    total: number;
    paymentTerms: string;
    notes: string;
    acceptanceInstructions: string;
    preparedBy: string;
  };
  client: {
    company: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    location: string;
    industry: string;
  };
  lines: QuotationLine[];
};

const NAVY = '#14233b';
const INK = '#1d2739';
const MUTED = '#6b7280';
const FAINT = '#9aa1ad';
const GOLD = '#c89a42';
const LINE = '#e3e1da';
const CANVAS = '#f7f5f0';

const naira = (value: number) => new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
const money = (currency: string, value: number) => `${currency} ${naira(value)}`;
const safe = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

function logoBuffer(): Buffer | null {
  try {
    return readFileSync(join(process.cwd(), 'public', 'brand', 'bkm-logo.png'));
  } catch {
    return null;
  }
}

type Ctx = PDFKit.PDFDocument;

function rule(doc: Ctx, y: number, colour = LINE, x = 48, width = 499) {
  doc.save().moveTo(x, y).lineTo(x + width, y).lineWidth(0.7).strokeColor(colour).stroke().restore();
}

function label(doc: Ctx, text: string, x: number, y: number, colour = FAINT) {
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(colour).text(text.toUpperCase(), x, y, { characterSpacing: 0.9 });
}

function value(doc: Ctx, text: string, x: number, y: number, width: number, opts: { size?: number; bold?: boolean; colour?: string; align?: 'left' | 'right' } = {}) {
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 9)
    .fillColor(opts.colour ?? INK)
    .text(text, x, y, { width, align: opts.align ?? 'left', lineBreak: true, ellipsis: true });
}

/** Header band: issuer identity on the left, document identity on the right. */
function header(doc: Ctx, input: QuotationDocumentInput) {
  doc.rect(0, 0, 595.28, 132).fill(NAVY);
  doc.rect(0, 132, 595.28, 2.4).fill(GOLD);

  const logo = logoBuffer();
  if (logo) {
    // The logo is a white plate in the source file; draw it on its own light card.
    doc.save().roundedRect(48, 34, 116, 46, 3).fill('#ffffff').restore();
    doc.image(logo, 52, 38, { fit: [108, 38] });
  } else {
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#ffffff').text(input.issuer.name.toUpperCase(), 48, 42, { lineBreak: false });
  }

  doc.font('Helvetica').fontSize(7.4).fillColor('#9fb0c6')
    .text(input.issuer.tagline, 48, 88, { width: 260, lineBreak: false });

  // Document identity, right aligned.
  const right = 547.28;
  doc.font('Helvetica-Bold').fontSize(27).fillColor('#ffffff')
    .text('QUOTATION', 300, 34, { width: 247.28, align: 'right', characterSpacing: -0.6 });
  doc.font('Helvetica').fontSize(9.5).fillColor(GOLD)
    .text(input.quotation.number, 300, 68, { width: 247.28, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(7.2).fillColor('#9fb0c6')
    .text(`Revision ${input.quotation.revision}`, 300, 80, { width: 247.28, align: 'right', lineBreak: false });

  label(doc, 'Issued', right - 178, 96, '#7e90a8');
  doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#ffffff').text(input.quotation.issueDate, right - 178, 106, { width: 80, align: 'right', lineBreak: false });
  label(doc, 'Valid until', right - 94, 96, '#7e90a8');
  doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#ffffff').text(input.quotation.validUntil, right - 94, 106, { width: 80, align: 'right', lineBreak: false });
}

/** Two columns under the header: who is issuing, who is being quoted. */
function parties(doc: Ctx, input: QuotationDocumentInput) {
  const top = 156;
  label(doc, 'From', 48, top, GOLD);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(input.issuer.name, 48, top + 12, { width: 220 });
  doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
    .text(input.issuer.addressLines.join('\n'), 48, top + 27, { width: 220, lineGap: 1.6 });
  const issuerExtra = [input.issuer.email, input.issuer.phone].filter(Boolean).join('  ·  ');
  doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(issuerExtra, 48, doc.y + 2, { width: 220 });
  if (input.issuer.pin) doc.font('Helvetica').fontSize(7.8).fillColor(MUTED).text(`PIN ${input.issuer.pin}`, 48, doc.y + 1, { width: 220 });

  label(doc, 'Prepared for', 300, top, GOLD);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(input.client.company, 300, top + 12, { width: 247 });
  const contactLines = [
    input.client.contactName,
    input.client.contactEmail,
    input.client.contactPhone,
    [input.client.industry, input.client.location].filter(Boolean).join(' · '),
  ].filter((line) => Boolean(line && String(line).trim()));
  doc.font('Helvetica').fontSize(7.8).fillColor(MUTED)
    .text(contactLines.join('\n'), 300, top + 27, { width: 247, lineGap: 1.6 });
}

/** The engagement summary strip. */
function subject(doc: Ctx, input: QuotationDocumentInput) {
  const y = 246;
  doc.save().roundedRect(48, y, 499, 52, 3).fill(CANVAS).restore();
  doc.rect(48, y, 3, 52).fill(GOLD);
  label(doc, 'Scope of engagement', 60, y + 10, FAINT);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(safe(input.quotation.service), 60, y + 20, { width: 475 });
  doc.font('Helvetica').fontSize(7.6).fillColor(MUTED).text(safe(input.quotation.description), 60, y + 33, { width: 475, height: 15, ellipsis: true });
}

const COLS = {
  description: { x: 54, w: 204 },
  quantity: { x: 262, w: 34 },
  unit: { x: 300, w: 78 },
  discount: { x: 382, w: 58 },
  tax: { x: 444, w: 36 },
  total: { x: 484, w: 57 },
};

function tableHead(doc: Ctx, y: number) {
  doc.save().rect(48, y, 499, 20).fill(NAVY).restore();
  const t = y + 6.6;
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor('#ffffff');
  doc.text('DESCRIPTION', COLS.description.x, t, { width: COLS.description.w, lineBreak: false });
  doc.text('QTY', COLS.quantity.x, t, { width: COLS.quantity.w, align: 'right', lineBreak: false });
  doc.text('UNIT PRICE', COLS.unit.x, t, { width: COLS.unit.w, align: 'right', lineBreak: false });
  doc.text('DISCOUNT', COLS.discount.x, t, { width: COLS.discount.w, align: 'right', lineBreak: false });
  doc.text('TAX', COLS.tax.x, t, { width: COLS.tax.w, align: 'right', lineBreak: false });
  doc.text('AMOUNT', COLS.total.x, t, { width: COLS.total.w, align: 'right', lineBreak: false });
  return y + 20;
}

function tableRows(doc: Ctx, input: QuotationDocumentInput, startY: number) {
  let y = startY;
  const currency = input.quotation.currency;

  input.lines.forEach((line, index) => {
    const rows = Math.max(1, Math.ceil(String(line.description).length / 40));
    const height = Math.max(24, 11 + rows * 9);
    if (y + height > 660) {
      doc.addPage();
      y = tableHead(doc, 48);
    }
    if (index % 2 === 1) doc.save().rect(48, y, 499, height).fill('#fbfaf7').restore();
    const ty = y + 8;
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK)
      .text(safe(line.description), COLS.description.x, ty, { width: COLS.description.w, lineGap: 1 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(String(line.quantity), COLS.quantity.x, ty, { width: COLS.quantity.w, align: 'right', lineBreak: false });
    doc.text(naira(line.unitPrice), COLS.unit.x, ty, { width: COLS.unit.w, align: 'right', lineBreak: false });
    doc.text(line.discountPct > 0 ? `${line.discountPct}%` : '—', COLS.discount.x, ty, { width: COLS.discount.w, align: 'right', lineBreak: false });
    doc.text(line.taxRate > 0 ? `${line.taxRate}%` : '—', COLS.tax.x, ty, { width: COLS.tax.w, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8.2).fillColor(INK)
      .text(naira(line.lineTotal), COLS.total.x, ty, { width: COLS.total.w, align: 'right', lineBreak: false });
    rule(doc, y + height, '#eceae4');
    y += height;
  });

  return y;
}

function totals(doc: Ctx, input: QuotationDocumentInput, y: number) {
  const q = input.quotation;
  const left = 330;
  const width = 217;
  const row = (name: string, amount: string, opts: { bold?: boolean; colour?: string } = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 9.4 : 8.4).fillColor(opts.colour ?? MUTED)
      .text(name, left, y, { width: 120, lineBreak: false });
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 9.4 : 8.4).fillColor(opts.colour ?? INK)
      .text(amount, left + 120, y, { width: width - 120, align: 'right', lineBreak: false });
    y += opts.bold ? 18 : 14;
  };

  y += 6;
  row('Subtotal', money(q.currency, q.subtotal));
  if (q.discountTotal > 0) row('Discount', `(${money(q.currency, q.discountTotal)})`);
  row(`${q.taxLabel}${q.taxRate ? ` (${q.taxRate}%)` : ''}`, money(q.currency, q.taxTotal));

  doc.save().roundedRect(left - 10, y + 2, width + 10, 34, 2).fill(NAVY).restore();
  // Right inset keeps the amount clear of the navy band's edge.
  const inset = 10;
  doc.font('Helvetica-Bold').fontSize(7.6).fillColor('#c3cedd').text('TOTAL PAYABLE', left, y + 12, { width: 120, characterSpacing: 1.1, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#ffffff').text(money(q.currency, q.total), left + 120, y + 8, { width: width - 120 - inset, align: 'right', lineBreak: false });
  return y + 46;
}

function blocks(doc: Ctx, input: QuotationDocumentInput, y: number) {
  const q = input.quotation;
  const sections: Array<[string, string]> = [
    ['Payment terms', q.paymentTerms],
    ['Notes', q.notes],
    ['How to accept this quotation', q.acceptanceInstructions],
  ];

  sections.forEach(([title, body]) => {
    if (!body) return;
    if (y > 690) { doc.addPage(); y = 48; }
    label(doc, title, 48, y, GOLD);
    doc.font('Helvetica').fontSize(7.8).fillColor('#4b5563')
      .text(safe(body), 48, y + 11, { width: 499, lineGap: 2.4 });
    y = doc.y + 14;
  });

  // Signature strip: acceptance on paper still works.
  if (y > 640) { doc.addPage(); y = 60; }
  y += 4;
  rule(doc, y, LINE);
  y += 14;
  label(doc, 'Accepted for and on behalf of the client', 48, y, FAINT);
  label(doc, 'Name, signature and date', 330, y, FAINT);
  rule(doc, y + 40, '#c9c7bd', 48, 230);
  rule(doc, y + 40, '#c9c7bd', 330, 217);
  doc.font('Helvetica').fontSize(6.8).fillColor(FAINT)
    .text('Sign and return this page, or confirm acceptance in writing quoting the quotation number above.', 48, y + 46, { width: 499 });
  return y + 62;
}

function footer(doc: Ctx, input: QuotationDocumentInput) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    // Draw below the content box without letting pdfkit paginate on the way down.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = 794;
    rule(doc, y, LINE);
    doc.font('Helvetica').fontSize(6.6).fillColor(FAINT)
      .text(`${input.issuer.name}  ·  ${input.issuer.website}  ·  ${input.issuer.email}`, 48, y + 7, { width: 360, lineBreak: false });
    doc.font('Helvetica').fontSize(6.6).fillColor(FAINT)
      .text(`${input.quotation.number}  ·  Page ${i + 1} of ${pages.count}`, 388, y + 7, { width: 159, align: 'right', lineBreak: false });
    doc.page.margins.bottom = saved;
  }
}

export function renderQuotationPdf(input: QuotationDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        bufferPages: true,
        info: {
          Title: `Quotation ${input.quotation.number}`,
          Author: input.issuer.name,
          Subject: `${input.quotation.service} — prepared for ${input.client.company}`,
          Keywords: `quotation, ${input.quotation.number}, ${input.client.company}`,
          Creator: 'BKM Operations Hub',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      header(doc, input);
      parties(doc, input);
      subject(doc, input);
      let y = tableHead(doc, 312);
      y = tableRows(doc, input, y);
      y = totals(doc, input, y);
      blocks(doc, input, y + 8);
      footer(doc, input);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** Plain-text body used by the email and WhatsApp deliveries. */
export function quotationMessage(input: QuotationDocumentInput, channel: 'email' | 'whatsapp') {
  const q = input.quotation;
  const total = money(q.currency, q.total);
  if (channel === 'whatsapp') {
    return [
      `Hello ${input.client.contactName || input.client.company},`,
      '',
      `Quotation *${q.number}* from ${input.issuer.name} is ready for your review.`,
      '',
      `Service: ${q.service}`,
      `Total: *${total}*`,
      `Valid until: ${q.validUntil}`,
      '',
      'I have attached the PDF with the full breakdown, payment terms and acceptance instructions. Reply here with any questions.',
      '',
      input.quotation.preparedBy ? `— ${input.quotation.preparedBy}, ${input.issuer.name}` : input.issuer.name,
    ].join('\n');
  }
  return [
    `Dear ${input.client.contactName || input.client.company},`,
    '',
    `Please find attached quotation ${q.number} for ${q.service}, prepared for ${input.client.company}.`,
    '',
    `The total payable is ${total}, and the quotation is valid until ${q.validUntil}. The attached document sets out the scope, line items, payment terms and how to accept.`,
    '',
    'If anything needs adjusting before you decide, reply to this email and we will issue a revised quotation.',
    '',
    'Kind regards,',
    input.quotation.preparedBy || input.issuer.name,
    input.issuer.name,
    input.issuer.email,
  ].join('\n');
}
