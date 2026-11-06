import type { AccountingSnapshot, JournalEntry, JournalLine } from './extended-types';

export interface ChartAccount { id: string; code: string; name: string; type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense'; balance: number }

const accounts: ChartAccount[] = [
  { id: 'acct-cash', code: '1000', name: 'Cash and bank', type: 'Asset', balance: 0 },
  { id: 'acct-receivable', code: '1100', name: 'Trade receivables', type: 'Asset', balance: 0 },
  { id: 'acct-equipment', code: '1500', name: 'Office equipment', type: 'Asset', balance: 0 },
  { id: 'acct-payable', code: '2000', name: 'Trade payables', type: 'Liability', balance: 0 },
  { id: 'acct-capital', code: '3000', name: 'Partner capital', type: 'Equity', balance: 0 },
  { id: 'acct-revenue', code: '4000', name: 'Professional fees', type: 'Revenue', balance: 0 },
  { id: 'acct-rent', code: '5100', name: 'Office rent', type: 'Expense', balance: 0 },
  { id: 'acct-payroll', code: '5200', name: 'Staff costs', type: 'Expense', balance: 0 },
];

const journalEntries: JournalEntry[] = [
  { id: 'je-001', date: '2026-09-01', description: 'Opening partner capital', reference: 'OPEN-001', status: 'Posted', lines: [{ accountId: 'acct-cash', debit: 1500000, credit: 0 }, { accountId: 'acct-capital', debit: 0, credit: 1500000 }] },
  { id: 'je-002', date: '2026-09-05', description: 'Professional fees billed to ABC Holdings Ltd', reference: 'INV-ABC-001', status: 'Posted', lines: [{ accountId: 'acct-receivable', debit: 420000, credit: 0 }, { accountId: 'acct-revenue', debit: 0, credit: 420000 }] },
  { id: 'je-003', date: '2026-09-12', description: 'Client receipt — ABC Holdings Ltd', reference: 'RCPT-ABC-001', status: 'Posted', lines: [{ accountId: 'acct-cash', debit: 250000, credit: 0 }, { accountId: 'acct-receivable', debit: 0, credit: 250000 }] },
  { id: 'je-004', date: '2026-09-15', description: 'September office rent', reference: 'EXP-RENT-001', status: 'Posted', lines: [{ accountId: 'acct-rent', debit: 95000, credit: 0 }, { accountId: 'acct-cash', debit: 0, credit: 95000 }] },
  { id: 'je-005', date: '2026-09-25', description: 'September staff costs', reference: 'PAY-SEP-001', status: 'Posted', lines: [{ accountId: 'acct-payroll', debit: 310000, credit: 0 }, { accountId: 'acct-cash', debit: 0, credit: 310000 }] },
  { id: 'je-006', date: '2026-09-28', description: 'Office equipment purchase', reference: 'CAPEX-001', status: 'Posted', lines: [{ accountId: 'acct-equipment', debit: 180000, credit: 0 }, { accountId: 'acct-payable', debit: 0, credit: 180000 }] },
];

const cents = (value: number) => Math.round(value * 100);
const isDebitNormal = (type: string) => type === 'Asset' || type === 'Expense';

export function validateJournalEntry(entry: JournalEntry, existingReferences: string[] = [], chart: ChartAccount[] = accounts) {
  if (!entry.id || !entry.reference.trim() || !entry.description.trim()) throw new Error('Journal entries require an id, reference and description.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(new Date(`${entry.date}T00:00:00Z`).getTime())) throw new Error(`Invalid journal date for ${entry.reference}.`);
  if (existingReferences.includes(entry.reference)) throw new Error(`Duplicate journal reference ${entry.reference} is not allowed.`);
  if (!entry.lines.length) throw new Error(`Journal entry ${entry.reference} must contain at least two lines.`);
  let debits = 0; let credits = 0;
  for (const line of entry.lines) {
    const account = chart.find((item) => item.id === line.accountId);
    if (!account) throw new Error(`Unknown account ${line.accountId} in ${entry.reference}.`);
    if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0)) throw new Error(`Each journal line must contain one non-negative debit or credit amount: ${entry.reference}.`);
    debits += line.debit; credits += line.credit;
  }
  if (cents(debits) !== cents(credits)) throw new Error(`Unbalanced journal entry ${entry.reference}: debits must equal credits.`);
  return true;
}

/**
 * Deterministic double-entry computation. Pure over its arguments so the
 * in-memory demonstration store and the Supabase repository share exactly
 * one implementation of the accounting math.
 */
export function computeAccountingSnapshot(chart: ChartAccount[], entries: JournalEntry[], options: { periodStart?: string; periodEnd?: string } = {}): AccountingSnapshot {
  const entryDates = entries.map((entry) => entry.date).sort();
  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const periodStart = options.periodStart ?? (entryDates[0] || currentMonthStart);
  const periodEnd = options.periodEnd ?? (entryDates[entryDates.length - 1] || today);
  const references: string[] = [];
  entries.forEach((entry) => { validateJournalEntry(entry, references, chart); references.push(entry.reference); });
  const selectedEntries = entries.filter((entry) => (entry.status ?? 'Posted') === 'Posted' && entry.date >= periodStart && entry.date <= periodEnd);
  const accountBalances = chart.map((account) => ({ ...account, balance: 0 }));
  const totals = new Map(chart.map((account) => [account.id, { debit: 0, credit: 0 }]));
  const running = new Map(chart.map((account) => [account.id, 0]));
  const ledger: AccountingSnapshot['ledger'] = [];
  for (const entry of selectedEntries) for (const line of entry.lines) {
    const account = accountBalances.find((item) => item.id === line.accountId)!;
    const total = totals.get(account.id)!; total.debit += line.debit; total.credit += line.credit;
    const signed = isDebitNormal(account.type) ? line.debit - line.credit : line.credit - line.debit;
    const next = (running.get(account.id) ?? 0) + signed; running.set(account.id, next); account.balance = next;
    ledger.push({ date: entry.date, reference: entry.reference, description: entry.description, accountId: account.id, debit: line.debit, credit: line.credit, runningBalance: next });
  }
  const trialBalance = accountBalances.map((account) => { const total = totals.get(account.id)!; return { accountId: account.id, debit: total.debit, credit: total.credit }; });
  const totalDebit = trialBalance.reduce((sum, row) => sum + row.debit, 0); const totalCredit = trialBalance.reduce((sum, row) => sum + row.credit, 0);
  const revenue = accountBalances.filter((item) => item.type === 'Revenue').reduce((sum, item) => sum + item.balance, 0);
  const expenses = accountBalances.filter((item) => item.type === 'Expense').reduce((sum, item) => sum + item.balance, 0);
  const assets = accountBalances.filter((item) => item.type === 'Asset').reduce((sum, item) => sum + item.balance, 0);
  const liabilities = accountBalances.filter((item) => item.type === 'Liability').reduce((sum, item) => sum + item.balance, 0);
  const capital = accountBalances.filter((item) => item.type === 'Equity').reduce((sum, item) => sum + item.balance, 0);
  const netProfit = revenue - expenses;
  // Cash-flow classification derived from the posted journal: entries that move
  // cash or bank accounts are bucketed by their counter accounts — equity and
  // borrowings are financing, non-current assets are investing, the rest are
  // operating. The empty journal therefore reports a genuinely empty statement.
  const cashIds = new Set(chart.filter((account) => account.type === 'Asset' && /cash|bank/i.test(account.name)).map((account) => account.id));
  const typeOf = new Map(chart.map((account) => [account.id, account.type] as const));
  const currentAssetPattern = /receivable|prepaid|inventory|debtor|current|suspense|control/i;
  const borrowingPattern = /loan|borrow|overdraft|note payable|finance/i;
  let cfOperating = 0; let cfInvesting = 0; let cfFinancing = 0;
  for (const entry of selectedEntries) {
    const cashDelta = entry.lines.filter((line) => cashIds.has(line.accountId)).reduce((sum, line) => sum + line.debit - line.credit, 0);
    if (cashDelta === 0) continue;
    const counters = entry.lines.filter((line) => !cashIds.has(line.accountId));
    const names = counters.map((line) => accountBalances.find((item) => item.id === line.accountId)?.name ?? '');
    const types = counters.map((line) => typeOf.get(line.accountId));
    let bucket: 'operating' | 'investing' | 'financing' = 'operating';
    if (types.includes('Equity') || (types.includes('Liability') && names.some((name) => borrowingPattern.test(name)))) bucket = 'financing';
    else if (types.includes('Asset') && names.some((name) => !currentAssetPattern.test(name))) bucket = 'investing';
    if (bucket === 'financing') cfFinancing += cashDelta; else if (bucket === 'investing') cfInvesting += cashDelta; else cfOperating += cashDelta;
  }
  const derivedCashFlow = { operating: cfOperating, investing: cfInvesting, financing: cfFinancing, netChange: cfOperating + cfInvesting + cfFinancing };
  return { metadata: { firmName: 'BenKim Associates', reportTitle: 'Internal financial statements', periodStart, periodEnd, currency: 'KES', basis: 'Deterministic posted double-entry journal', preparedAt: new Date().toISOString() }, accounts: accountBalances, journalEntries: selectedEntries, ledger, trialBalance, trialBalanceTotals: { debit: totalDebit, credit: totalCredit, difference: totalDebit - totalCredit }, incomeStatement: { revenue, expenses, netProfit }, balanceSheet: { assets, liabilities, equity: capital + netProfit, balanced: Math.abs(assets - (liabilities + capital + netProfit)) < 0.01 }, cashFlow: derivedCashFlow };
}

export function getAccountingSnapshot(options: { periodStart?: string; periodEnd?: string } = {}): AccountingSnapshot {
  return computeAccountingSnapshot(accounts, journalEntries, options);
}

export function addJournalEntry(entry: JournalEntry) { validateJournalEntry(entry, journalEntries.map((item) => item.reference)); journalEntries.push({ ...entry, status: entry.status ?? 'Posted' }); return getAccountingSnapshot(); }

export function reverseJournalEntry(reference: string) {
  const entry = journalEntries.find((item) => item.reference === reference);
  if (!entry) throw new Error(`Journal reference ${reference} was not found.`);
  if ((entry.status ?? 'Posted') !== 'Posted') throw new Error('Only posted journal entries can be reversed.');
  entry.status = 'Reversed';
  return getAccountingSnapshot();
}

export const demoChartOfAccounts = accounts;
export const demoJournalEntries = journalEntries;
export type { JournalLine };
