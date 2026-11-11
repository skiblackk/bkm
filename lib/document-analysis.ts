/**
 * Answers a question about an uploaded document.
 *
 * Every figure in the reply is computed by ./accounting-engine from the parsed
 * rows; the language model is used only for wording and for topics the engine
 * does not cover (contracts, policies, correspondence). If the model is
 * unreachable the computed statement is still returned, so the user always
 * gets their numbers.
 */

import { getAiProvider, resolveModel, chatCompletionsUrl } from './ai-provider';
import { analyseDocument, type DocumentAnalysis } from './accounting-engine';
import type { Grid } from './document-parser';

export type DocumentAnswer = {
  answer: string;
  model: string | null;
  computed: boolean;
  analysis: DocumentAnalysis;
};

export type DocumentInput = {
  filename: string;
  text: string;
  grid: Grid;
  warnings: string[];
};

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Render the computed statements as the plain-text layout AiAnswer designs. */
export function renderStatements(analysis: DocumentAnalysis, title: string): string {
  const { statements, diagnostics } = analysis;
  const currency = analysis.currency;
  const lines: string[] = [];
  lines.push(`${title} for ${currency}.`);

  const section = (heading: string, rows: Array<{ label: string; amount: number }>, totalLabel: string) => {
    if (!rows.length) return;
    lines.push('');
    lines.push(`${heading}:`);
    for (const row of rows.slice(0, 18)) lines.push(`- ${row.label}: ${money(currency, row.amount)}`);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    lines.push(`${totalLabel}: ${money(currency, total)}`);
  };

  if (analysis.kind === 'trial-balance') {
    section('Assets', statements.assets, 'Total assets');
    section('Liabilities', statements.liabilities, 'Total liabilities');
    section('Equity', statements.equity, 'Total equity');
    section('Income', statements.revenue, 'Total income');
    section('Expenditure', statements.expenses, 'Total expenditure');
    lines.push('');
    lines.push(`Net profit: ${money(currency, statements.totals.netProfit)}`);
    lines.push(`Balance check: ${money(currency, statements.totals.balanceCheck)}`);
  } else if (analysis.kind === 'ledger') {
    section('Money in', statements.revenue, 'Total money in');
    section('Money out', statements.expenses, 'Total money out');
    lines.push('');
    lines.push(`Net movement: ${money(currency, statements.totals.netProfit)}`);
    if (diagnostics.openingBalance !== null) lines.push(`Opening balance: ${money(currency, diagnostics.openingBalance)}`);
    if (diagnostics.closingBalance !== null) lines.push(`Closing balance: ${money(currency, diagnostics.closingBalance)}`);
    lines.push(`Transactions counted: ${diagnostics.rowsCounted.toLocaleString()}`);
  } else {
    lines.push('');
    lines.push(`Rows read: ${diagnostics.rowsRead.toLocaleString()}`);
    lines.push(`Transactions counted: ${diagnostics.rowsCounted.toLocaleString()}`);
  }
  return lines.join('\n');
}

function questionWants(question: string) {
  const value = question.toLowerCase();
  return {
    balanceSheet: /balance\s*sheet|statement of financial position|assets and liabilities/.test(value),
    ledger: /ledger|transactions|statement of account|entries|listing|details/.test(value),
    income: /profit|income statement|p&l|p and l|revenue|expenses|expenditure/.test(value),
    trialBalance: /trial balance/.test(value),
    summary: /summar|overview|what.*(this|the).*(file|document)|explain/.test(value),
  };
}

function trimmedContext(text: string, limit = 14000) {
  const clean = text.replace(/[ \t]{2,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= limit) return clean;
  const head = clean.slice(0, Math.floor(limit * 0.65));
  const tail = clean.slice(-Math.floor(limit * 0.3));
  return `${head}\n\n[... ${(clean.length - limit).toLocaleString()} characters omitted from the middle ...]\n\n${tail}`;
}

export async function answerDocumentQuestion(input: DocumentInput, question: string): Promise<DocumentAnswer> {
  const analysis = analyseDocument(input.grid, input.warnings);
  const wants = questionWants(question);
  const hasFigures = analysis.kind !== 'unknown';
  const title = wants.balanceSheet ? 'Balance sheet' : wants.trialBalance ? 'Trial balance' : wants.income ? 'Income statement' : wants.ledger ? 'Ledger summary' : 'Financial summary';

  // The computed statement is the backbone of the answer and is always shown.
  const computedBody = hasFigures ? renderStatements(analysis, title) : '';
  const ledgerTable = wants.ledger && analysis.ledger.length
    ? analysis.ledger.slice(0, 40).map((row) => `${row.date || '—'} | ${row.description.slice(0, 60)} | ${row.debit ? money(analysis.currency, row.debit) : ''} | ${row.credit ? money(analysis.currency, row.credit) : ''}`).join('\n')
    : '';

  const provider = getAiProvider();
  if (!provider) {
    return { answer: computedBody || 'No AI model is configured on the server, and no figures could be computed from this file.', model: null, computed: hasFigures, analysis };
  }

  const model = await resolveModel(provider);
  const facts = JSON.stringify({
    document: input.filename,
    detectedKind: analysis.kind,
    currency: analysis.currency,
    computedTotals: analysis.statements.totals,
    diagnostics: analysis.diagnostics,
    computedStatement: computedBody,
    ledgerPreview: analysis.ledger.slice(0, 40),
    warnings: analysis.warnings,
  });

  const system = `You are the BKM work assistant at BenKim Associates, an audit and advisory firm in Nairobi, Kenya. The user uploaded a business document and asked a question about it.

All arithmetic has already been done for you and is supplied as JSON in the user message. Rules:
- Never recalculate, round or restate a total differently from the JSON. Quote the computed figures exactly.
- If "detectedKind" is "unknown" or the computed totals are empty, say plainly that the file did not contain rows the engine could total, and tell the user what column headers would let it work. Do not invent figures.
- Answer the specific thing asked. If the user asked for a balance sheet, structure the reply as a balance sheet. If they asked for a ledger, list the entries.
- Where the document genuinely does not support what was asked, say what is missing instead of padding.
- Never claim to have posted a journal, filed a return or changed any record.

Write plain text for a designed panel. Never use asterisks, hash signs, backticks or pipe tables except the supplied ledger preview lines. Lead with one short headline sentence. Then put each figure on its own line as "Label: value". Use lines beginning "- " for grouped detail. Keep lines under about 80 characters.`;

  const user = `Computed facts:
${facts}

Document text (truncated for context):
${trimmedContext(input.text)}

Question: ${question}`;

  try {
    const response = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model, max_completion_tokens: 1600, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!response.ok) {
      return { answer: computedBody || `The document was read but the assistant model returned HTTP ${response.status}.`, model, computed: hasFigures, analysis };
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
    let answer = raw.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();
    if (!answer) answer = computedBody;
    if (ledgerTable) answer = `${answer}\n\nLedger entries:\n| Date | Description | Debit | Credit |\n| --- | --- | --- | --- |\n${ledgerTable}`;
    return { answer, model, computed: hasFigures, analysis };
  } catch {
    return { answer: computedBody || 'The document was read but the assistant could not be reached.', model, computed: hasFigures, analysis };
  }
}
