/**
 * Uploaded client documents.
 *
 * Files are parsed on upload and the extracted text plus the computed
 * accounting analysis are stored in `document_extractions`, so a document can
 * be reopened and questioned days later instead of vanishing when the
 * serverless instance recycles. Raw bytes are not retained.
 */

import { randomUUID } from 'node:crypto';
import { parseDocument, type Grid } from './document-parser';
import { analyseDocument, type DocumentAnalysis } from './accounting-engine';
import { createSupabaseAdminClient } from './supabase/admin';

export type ScanStatus = 'AI analyzed' | 'Extracted for review' | 'Failed';

export type DocumentKeyField = { label: string; value: string };

export type UploadedDocument = {
  id: string;
  ownerId: string;
  clientId: string;
  clientName: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  status: ScanStatus;
  summary: string;
  keyFields: DocumentKeyField[];
  transactions: { date: string; description: string; amount: string }[];
  warnings: string[];
  analysis: DocumentAnalysis | null;
};

type StoredDocument = UploadedDocument & { extractedText: string; grid: Grid };

/** Kept only so a document uploaded moments ago can be read before the row lands. */
const recent = new Map<string, StoredDocument>();

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function summarise(filename: string, analysis: DocumentAnalysis, rowCount: number): { summary: string; keyFields: DocumentKeyField[]; transactions: UploadedDocument['transactions']; status: ScanStatus } {
  const currency = analysis.currency;
  const totals = analysis.statements.totals;
  const keyFields: DocumentKeyField[] = [
    { label: 'Rows read', value: rowCount.toLocaleString() },
    { label: 'Transactions counted', value: analysis.diagnostics.rowsCounted.toLocaleString() },
    { label: 'Currency', value: currency },
  ];
  let summary: string;
  if (analysis.kind === 'trial-balance') {
    summary = `${filename} was read as a trial balance: ${analysis.diagnostics.rowsCounted} account lines totalling ${money(currency, analysis.diagnostics.debitTotal)} debit and ${money(currency, analysis.diagnostics.creditTotal)} credit. The statements below were calculated from those lines.`;
    keyFields.push({ label: 'Total assets', value: money(currency, totals.assets) }, { label: 'Total liabilities', value: money(currency, totals.liabilities) }, { label: 'Net profit', value: money(currency, totals.netProfit) });
  } else if (analysis.kind === 'ledger') {
    summary = `${filename} was read as a transaction listing: ${analysis.diagnostics.rowsCounted} entries over the period. Money in and money out were classified from the row descriptions, not guessed.`;
    if (analysis.diagnostics.openingBalance !== null) keyFields.push({ label: 'Opening balance', value: money(currency, analysis.diagnostics.openingBalance) });
    if (analysis.diagnostics.closingBalance !== null) keyFields.push({ label: 'Closing balance', value: money(currency, analysis.diagnostics.closingBalance) });
    keyFields.push({ label: 'Net movement', value: money(currency, totals.netProfit) });
  } else {
    summary = `${filename} was read, but no dated rows with amounts were found, so no financial statement could be calculated. The full text is still available to the assistant for questions about its contents.`;
  }
  const transactions = analysis.ledger.slice(0, 60).map((row) => ({
    date: row.date || '—',
    description: row.description.slice(0, 160),
    amount: row.debit ? money(currency, row.debit) : row.credit ? money(currency, row.credit) : row.balance !== null ? money(currency, row.balance) : '—',
  }));
  return { summary, keyFields, transactions, status: analysis.kind === 'unknown' ? 'Extracted for review' : 'AI analyzed' };
}

export async function scanUploadedDocument(input: {
  ownerId: string;
  clientId: string;
  clientName: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const parsed = await parseDocument(input.filename, input.mimeType, input.bytes);
  const analysis = analyseDocument(parsed.grid, [...parsed.warnings]);
  const { summary, keyFields, transactions, status } = summarise(input.filename, analysis, parsed.grid.length);

  const document: StoredDocument = {
    id: randomUUID(),
    ownerId: input.ownerId,
    clientId: input.clientId,
    clientName: input.clientName,
    filename: input.filename,
    size: input.bytes.length,
    mimeType: input.mimeType,
    uploadedAt: new Date().toISOString(),
    status,
    summary,
    keyFields,
    transactions,
    warnings: analysis.warnings,
    analysis,
    extractedText: parsed.text.slice(0, 200000),
    grid: parsed.grid.slice(0, 4000),
  };

  recent.set(document.id, document);
  if (recent.size > 40) { const oldest = Array.from(recent.keys())[0]; if (oldest) recent.delete(oldest); }

  const admin = createSupabaseAdminClient();
  if (admin) {
    await admin.from('document_extractions').insert({
      id: document.id,
      filename: document.filename,
      status: document.status,
      summary: document.summary,
      extracted_json: {
        ownerId: document.ownerId,
        clientId: document.clientId,
        clientName: document.clientName,
        size: document.size,
        mimeType: document.mimeType,
        uploadedAt: document.uploadedAt,
        keyFields: document.keyFields,
        transactions: document.transactions,
        warnings: document.warnings,
        analysis: document.analysis,
        extractedText: document.extractedText,
        grid: document.grid,
      },
    }).then(({ error }: { error: { message: string } | null }) => {
      if (error && !/relation .* does not exist/i.test(error.message)) console.error('document_extractions insert failed:', error.message);
    });
  }

  return document;
}

function fromRow(row: { id: string; filename: string; status: string; summary: string; created_at: string; extracted_json: Record<string, unknown> }): StoredDocument {
  const json = row.extracted_json ?? {};
  return {
    id: String(row.id),
    filename: String(row.filename),
    status: row.status as ScanStatus,
    summary: String(row.summary),
    uploadedAt: String(json.uploadedAt ?? row.created_at),
    size: Number(json.size ?? 0),
    mimeType: String(json.mimeType ?? ''),
    clientId: String(json.clientId ?? ''),
    clientName: String(json.clientName ?? ''),
    ownerId: String(json.ownerId ?? ''),
    keyFields: (json.keyFields as DocumentKeyField[]) ?? [],
    transactions: (json.transactions as UploadedDocument['transactions']) ?? [],
    warnings: (json.warnings as string[]) ?? [],
    analysis: (json.analysis as DocumentAnalysis) ?? null,
    extractedText: String(json.extractedText ?? ''),
    grid: (json.grid as Grid) ?? [],
  };
}

export async function listUploadedDocuments(filter: { ownerId: string; clientId?: string }): Promise<UploadedDocument[]> {
  const admin = createSupabaseAdminClient();
  const rows: StoredDocument[] = [];
  if (admin) {
    const { data } = await admin.from('document_extractions').select('id, filename, status, summary, created_at, extracted_json').order('created_at', { ascending: false }).limit(200);
    for (const row of data ?? []) {
      const item = fromRow(row as never);
      if (item.ownerId && item.ownerId !== filter.ownerId) continue;
      rows.push(item);
    }
  }
  for (const item of Array.from(recent.values())) {
    if (item.ownerId !== filter.ownerId) continue;
    if (!rows.some((existing) => existing.id === item.id)) rows.unshift(item);
  }
  rows.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  return rows
    .filter((item) => !filter.clientId || item.clientId === filter.clientId)
    .map(({ extractedText: _text, grid: _grid, ...item }) => item);
}

/** Full record including the extracted text, for answering a question about it. */
export async function getUploadedDocument(id: string, ownerId: string): Promise<StoredDocument | null> {
  const local = recent.get(id);
  if (local && local.ownerId === ownerId) return local;
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin.from('document_extractions').select('id, filename, status, summary, created_at, extracted_json').eq('id', id).maybeSingle();
  if (!data) return null;
  const item = fromRow(data as never);
  return item.ownerId && item.ownerId !== ownerId ? null : item;
}
