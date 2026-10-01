import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
export type ScanStatus = 'AI analyzed' | 'Extracted for review' | 'Failed';
export interface UploadedDocument { id: string; clientId: string; clientName: string; filename: string; size: number; mimeType: string; uploadedAt: string; status: ScanStatus; summary: string; extractedText: string; keyFields: { label: string; value: string }[]; transactions: { date: string; description: string; amount: string }[]; warnings: string[]; }
const uploads: UploadedDocument[] = [];

function localAnalyze(text: string, filename: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const transactions = lines.slice(0, 80).map((line) => { const parts = line.split(/[,;\t|]/).map((part) => part.trim()); const date = parts.find((part) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(part)) ?? ''; const amount = parts.find((part) => /(?:KES|USD|EUR|GBP)?\s?\d[\d,]*(?:\.\d{2})?/.test(part.replace(/[^\d.,A-Za-z\s]/g, ''))) ?? ''; return date && amount ? { date, description: parts.filter((part) => part !== date && part !== amount).join(' · ').slice(0, 120), amount } : null; }).filter(Boolean) as UploadedDocument['transactions'];
  const amounts = (text.match(/(?:KES|USD|EUR|GBP)?\s?\d[\d,]*(?:\.\d{2})?/g) ?? []).slice(0, 20);
  return { summary: `${filename} was read server-side. The scan found ${lines.length} non-empty lines, ${transactions.length} transaction-like rows and ${amounts.length} amount fields. Review the extracted fields before posting anything to accounting.`, keyFields: [{ label: 'Lines read', value: String(lines.length) }, { label: 'Transaction-like rows', value: String(transactions.length) }, { label: 'Amount fields', value: String(amounts.length) }], transactions, warnings: transactions.length === 0 ? ['No transaction-like rows were confidently detected. Upload a CSV or text-based PDF with dates and amounts for better extraction.'] : ['Extraction is a reviewable draft. It does not create accounting entries automatically.'] };
}

async function aiEnhance(text: string, filename: string, base: ReturnType<typeof localAnalyze>) {
  const apiKey = process.env.OPENAI_API_KEY; const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1'; const model = process.env.AI_MODEL || 'gpt-5-mini';
  if (!apiKey) return { ...base, status: 'Extracted for review' as const };
  try {
    const response = await fetch(`${apiBase}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_completion_tokens: 1400, messages: [{ role: 'system', content: 'You analyze uploaded business documents. Never invent facts. Return concise JSON with summary, keyFields (label/value), transactions (date/description/amount), and warnings. Only use the supplied text.' }, { role: 'user', content: `Filename: ${filename}\nDocument text:\n${text.slice(0, 30000)}` }], response_format: { type: 'json_schema', json_schema: { name: 'document_scan', strict: true, schema: { type: 'object', properties: { summary: { type: 'string' }, keyFields: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'], additionalProperties: false } }, transactions: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, description: { type: 'string' }, amount: { type: 'string' } }, required: ['date', 'description', 'amount'], additionalProperties: false } }, warnings: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'keyFields', 'transactions', 'warnings'], additionalProperties: false } } } }) });
    if (!response.ok) return { ...base, status: 'Extracted for review' as const };
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] }; const raw = payload.choices?.[0]?.message?.content ?? ''; const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    return { ...base, summary: parsed.summary || base.summary, keyFields: Array.isArray(parsed.keyFields) ? parsed.keyFields.slice(0, 12) : base.keyFields, transactions: Array.isArray(parsed.transactions) ? parsed.transactions.slice(0, 80) : base.transactions, warnings: Array.isArray(parsed.warnings) ? parsed.warnings : base.warnings, status: 'AI analyzed' as const };
  } catch { return { ...base, status: 'Extracted for review' as const }; }
}

export function listUploadedDocuments(clientId?: string) { return uploads.filter((item) => !clientId || item.clientId === clientId).map(({ extractedText: _text, ...item }) => item); }
export async function scanUploadedDocument(input: { clientId: string; clientName: string; filename: string; mimeType: string; bytes: Buffer; }) {
  const extension = input.filename.toLowerCase().split('.').pop(); if (!['csv', 'txt', 'pdf'].includes(extension ?? '')) throw new Error('Upload a PDF, CSV or TXT document.');
  let text = extension === 'pdf' ? '' : input.bytes.toString('utf8'); const tempPath = `/tmp/bkm-upload-${randomUUID()}.${extension}`;
  try { if (extension === 'pdf') { await writeFile(tempPath, input.bytes); const result = await execFileAsync('pdftotext', [tempPath, '-']); text = result.stdout; } const base = localAnalyze(text, input.filename); const analyzed = await aiEnhance(text, input.filename, base); const document: UploadedDocument = { id: `upload-${randomUUID()}`, clientId: input.clientId, clientName: input.clientName, filename: input.filename, size: input.bytes.length, mimeType: input.mimeType, uploadedAt: new Date().toISOString(), extractedText: text.slice(0, 60000), ...analyzed }; uploads.unshift(document); return document; } finally { await unlink(tempPath).catch(() => undefined); }
}
