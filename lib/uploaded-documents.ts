import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const execFileAsync = promisify(execFile);
export type ScanStatus = 'AI analyzed' | 'Extracted for review' | 'Failed';
export interface UploadedDocument { id: string; clientId: string; clientName: string; filename: string; size: number; mimeType: string; uploadedAt: string; status: ScanStatus; summary: string; extractedText: string; keyFields: { label: string; value: string }[]; transactions: { date: string; description: string; amount: string }[]; warnings: string[]; }
const uploads: UploadedDocument[] = [];

function localAnalyze(text: string, filename: string, workbookMeta?: { sheets: string[]; rows: number }) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const transactions = lines.slice(0, 120).map((line) => { const parts = line.split(/[,;\t|]/).map((part) => part.trim()); const date = parts.find((part) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(part)) ?? ''; const amount = parts.find((part) => /(?:KES|USD|EUR|GBP)?\s?\d[\d,]*(?:\.\d{2})?/.test(part.replace(/[^\d.,A-Za-z\s-]/g, ''))) ?? ''; return date && amount ? { date, description: parts.filter((part) => part !== date && part !== amount).join(' · ').slice(0, 160), amount } : null; }).filter(Boolean) as UploadedDocument['transactions'];
  const amounts = (text.match(/(?:KES|USD|EUR|GBP)?\s?\d[\d,]*(?:\.\d{2})?/g) ?? []).slice(0, 30);
  const workbookNote = workbookMeta ? ` It contains ${workbookMeta.sheets.length} worksheet${workbookMeta.sheets.length === 1 ? '' : 's'} and ${workbookMeta.rows.toLocaleString()} data rows.` : '';
  return { summary: `${filename} was read server-side across the full available text.${workbookNote} The review found ${lines.length.toLocaleString()} non-empty lines, ${transactions.length} transaction-like preview rows and ${amounts.length} sampled amount fields. Ask for a specific schedule, balance sheet or management summary and review the source before posting anything to accounting.`, keyFields: [{ label: 'Rows / lines read', value: lines.length.toLocaleString() }, ...(workbookMeta ? [{ label: 'Worksheets', value: String(workbookMeta.sheets.length) }, { label: 'Workbook rows', value: workbookMeta.rows.toLocaleString() }] : []), { label: 'Transaction preview', value: String(transactions.length) }, { label: 'Amount fields sampled', value: String(amounts.length) }], transactions, warnings: transactions.length === 0 ? ['No transaction-like rows were confidently detected. Include headers with dates and amounts for better extraction.'] : ['Extraction is a reviewable draft. It does not create accounting entries automatically.'] };
}

async function aiEnhance(text: string, filename: string, base: ReturnType<typeof localAnalyze>, instruction?: string) {
  const apiKey = process.env.OPENAI_API_KEY; const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'; const model = process.env.AI_MODEL || 'gpt-5-mini';
  if (!apiKey) return { ...base, status: 'Extracted for review' as const };
  try {
    const response = await fetch(`${apiBase}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_completion_tokens: 1800, messages: [{ role: 'system', content: 'You are a careful BKM accounting co-worker. Follow the user instruction, use only supplied data, state assumptions, and never invent figures. Return concise JSON with summary, keyFields (label/value), transactions (date/description/amount), and warnings. For a balance sheet or financial statement request, explain whether the uploaded data is sufficient and show calculated totals only when supported by the data.' }, { role: 'user', content: `User instruction: ${instruction || 'Review and summarize this business document.'}\nFilename: ${filename}\nDocument text and workbook sample:\n${text.slice(0, 60000)}` }], response_format: { type: 'json_schema', json_schema: { name: 'document_scan', strict: true, schema: { type: 'object', properties: { summary: { type: 'string' }, keyFields: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'], additionalProperties: false } }, transactions: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, description: { type: 'string' }, amount: { type: 'string' } }, required: ['date', 'description', 'amount'], additionalProperties: false } }, warnings: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'keyFields', 'transactions', 'warnings'], additionalProperties: false } } } }) });
    if (!response.ok) return { ...base, status: 'Extracted for review' as const };
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] }; const raw = payload.choices?.[0]?.message?.content ?? ''; const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    return { ...base, summary: parsed.summary || base.summary, keyFields: Array.isArray(parsed.keyFields) ? parsed.keyFields.slice(0, 14) : base.keyFields, transactions: Array.isArray(parsed.transactions) ? parsed.transactions.slice(0, 120) : base.transactions, warnings: Array.isArray(parsed.warnings) ? parsed.warnings : base.warnings, status: 'AI analyzed' as const };
  } catch { return { ...base, status: 'Extracted for review' as const }; }
}

export function listUploadedDocuments(clientId?: string) { return uploads.filter((item) => !clientId || item.clientId === clientId).map(({ extractedText: _text, ...item }) => item); }
export async function scanUploadedDocument(input: { clientId: string; clientName: string; filename: string; mimeType: string; bytes: Buffer; instruction?: string; }) {
  const extension = input.filename.toLowerCase().split('.').pop(); if (!['csv', 'txt', 'pdf', 'xlsx', 'xls'].includes(extension ?? '')) throw new Error('Upload a PDF, CSV, TXT or Excel workbook.');
  let text = ''; let workbookMeta: { sheets: string[]; rows: number } | undefined;
  const tempPath = `/tmp/bkm-upload-${randomUUID()}.${extension}`;
  try {
    if (extension === 'pdf') { await writeFile(tempPath, input.bytes); const result = await execFileAsync('pdftotext', [tempPath, '-']); text = result.stdout; }
    else if (extension === 'xlsx' || extension === 'xls') {
      const workbook = XLSX.read(input.bytes, { type: 'buffer', cellDates: true, cellNF: false, cellStyles: false });
      const sheets = workbook.SheetNames;
      let rows = 0;
      text = sheets.map((sheetName) => { const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false }); rows += Math.max(0, csv.split(/\r?\n/).filter(Boolean).length - 1); return `WORKSHEET: ${sheetName}\n${csv}`; }).join('\n\n');
      workbookMeta = { sheets, rows };
    } else text = input.bytes.toString('utf8');
    const base = localAnalyze(text, input.filename, workbookMeta); const analyzed = await aiEnhance(text, input.filename, base, input.instruction);
    const document: UploadedDocument = { id: `upload-${randomUUID()}`, clientId: input.clientId, clientName: input.clientName, filename: input.filename, size: input.bytes.length, mimeType: input.mimeType, uploadedAt: new Date().toISOString(), extractedText: text.slice(0, 120000), ...analyzed };
    uploads.unshift(document); return document;
  } finally { await unlink(tempPath).catch(() => undefined); }
}
