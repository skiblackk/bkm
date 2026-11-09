/**
 * Deterministic accounting analysis of an uploaded document.
 *
 * The language model is never asked to add up a column. Every figure in a
 * balance sheet, ledger or summary produced from an upload is calculated here
 * from the parsed cells, so the numbers can be checked against the source
 * document by hand.
 */

import type { Grid } from './document-parser';

export type LedgerRow = {
  date: string;
  description: string;
  account: string;
  debit: number;
  credit: number;
  balance: number | null;
};

export type StatementLine = { label: string; amount: number; emphasis?: boolean };

export type Statements = {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  revenue: StatementLine[];
  expenses: StatementLine[];
  totals: {
    assets: number;
    liabilities: number;
    equity: number;
    revenue: number;
    expenses: number;
    netProfit: number;
    balanceCheck: number;
  };
};

export type DocumentAnalysis = {
  kind: 'ledger' | 'balance-sheet' | 'trial-balance' | 'income-statement' | 'unknown';
  currency: string;
  ledger: LedgerRow[];
  statements: Statements;
  diagnostics: {
    rowsRead: number;
    rowsCounted: number;
    rowsSkipped: number;
    openingBalance: number | null;
    closingBalance: number | null;
    debitTotal: number;
    creditTotal: number;
    balanceDifference: number;
    columns: string[];
  };
  warnings: string[];
};

const MONEY = /-?\(?\s*(?:[A-Z]{3}\s*)?-?\d[\d,\s]*(?:\.\d{1,2})?\s*\)?/;
const DATE_PATTERNS = [
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/,
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/,
  /^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4}$/i,
  /^\d{1,2}[- ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[- ]\d{2,4}$/i,
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}$/i,
  /^\d{1,2}\/\d{1,2}$/,
];

/** Parse "1,234.50", "(1,234.50)", "-1 234,50", "KES 1,234.50". */
export function parseAmount(raw: string): number | null {
  const value = String(raw ?? '').trim();
  if (!value || !/\d/.test(value)) return null;
  if (!MONEY.test(value)) return null;
  const negative = /^\(.*\)$/.test(value) || /^-/.test(value.replace(/[A-Za-z]{3}\s*/, ''));
  let cleaned = value.replace(/[^0-9,.\-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const digitsAfterComma = cleaned.length - lastComma - 1;
  const digitsAfterDot = cleaned.length - lastDot - 1;
  if (lastComma > -1 && lastDot > -1) {
    // The right-most symbol is the decimal separator.
    if (lastComma > lastDot) cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    else cleaned = cleaned.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A comma followed by exactly three digits is a thousands separator.
    cleaned = digitsAfterComma === 3 && cleaned.split(',').length === 2 ? cleaned.replace(',', '') : cleaned.replace(/,/g, '.');
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export function isDateCell(value: string) {
  const trimmed = String(value ?? '').trim();
  return Boolean(trimmed) && DATE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const HEADER_WORDS = /^(date|posted|value date|description|details|narration|particulars|memo|account|account name|ledger|code|nominal|debit|credit|dr|cr|amount|value|net|balance|running balance|bal|reference|ref)$/i;

function looksLikeHeader(row: string[]) {
  const cells = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);
  if (cells.length < 2) return false;
  // A header row names its columns; it never holds a figure or a date.
  if (cells.some((cell) => parseAmount(cell) !== null || isDateCell(cell))) return false;
  const named = cells.filter((cell) => HEADER_WORDS.test(cell) || HEADER_WORDS.test(cell.replace(/\s+/g, ' '))).length;
  return named >= 2;
}

function normaliseHeader(row: string[]) {
  return row.map((cell) => String(cell ?? '').trim().toLowerCase());
}

function findColumn(header: string[], candidates: RegExp) {
  return header.findIndex((cell) => candidates.test(cell));
}

const CURRENCY = /(?:KES|USD|EUR|GBP|TZS|UGX|RWF|ZAR|AED|INR|CNY|JPY|CAD|AUD)\b|\b(?:ksh|shs|usd|us\$|eur|gbp)\b/i;

function detectCurrency(grid: Grid) {
  const sample = grid.slice(0, 60).map((row) => row.join(' ')).join(' ');
  const match = sample.match(CURRENCY);
  return match ? match[0].toUpperCase().replace(/KSH|SHS/, 'KES') : 'KES';
}

/** Pull a running balance out of the last numeric column, when present. */
function isBalanceHeader(header: string[]) {
  return findColumn(header, /^\s*(running\s*)?(balance|bal)\s*$/i);
}

type ColumnMap = { date: number; description: number; account: number; debit: number; credit: number; amount: number; balance: number };

function mapColumns(header: string[]): ColumnMap {
  return {
    date: findColumn(header, /date|posted|value\s*date/i),
    description: findColumn(header, /description|details|narration|particulars|memo/i),
    account: findColumn(header, /account|ledger|nominal|code/i),
    debit: findColumn(header, /debit|\bdr\b/i),
    credit: findColumn(header, /credit|\bcr\b/i),
    amount: findColumn(header, /amount|value|net/i),
    balance: isBalanceHeader(header),
  };
}

/**
 * Read the ledger rows. Handles three common shapes: Dr/Cr pairs, a signed
 * amount column, and a running-balance column with no Dr/Cr split.
 */
function extractLedger(grid: Grid): { ledger: LedgerRow[]; columns: string[]; skipped: number; debitTotal: number; creditTotal: number; header: string[] } {
  const headerIndex = grid.findIndex((row) => looksLikeHeader(row) && row.filter((cell) => cell.trim()).length > 2);
  const header = headerIndex > -1 ? normaliseHeader(grid[headerIndex]) : [];
  const columns = mapColumns(header);
  const body = headerIndex > -1 ? grid.slice(headerIndex + 1) : grid;
  const ledger: LedgerRow[] = [];
  let skipped = 0;
  let debitTotal = 0;
  let creditTotal = 0;

  for (const row of body) {
    if (!row.some((cell) => String(cell).trim())) continue;
    const text = row.join(' ');
    if (/^(total|totals|subtotal|balance b\/?f|brought forward|carried forward|closing balance)\b/i.test(text.trim())) continue;

    let date = '';
    let description = '';
    let account = '';
    let debit = 0;
    let credit = 0;
    let balance: number | null = null;

    if (header.length) {
      date = columns.date > -1 ? String(row[columns.date] ?? '').trim() : '';
      description = columns.description > -1 ? String(row[columns.description] ?? '').trim() : '';
      account = columns.account > -1 ? String(row[columns.account] ?? '').trim() : '';
      debit = columns.debit > -1 ? (parseAmount(row[columns.debit] ?? '') ?? 0) : 0;
      credit = columns.credit > -1 ? (parseAmount(row[columns.credit] ?? '') ?? 0) : 0;
      if (columns.balance > -1) balance = parseAmount(row[columns.balance] ?? '');
      if (columns.debit === -1 && columns.credit === -1) {
        const amount = columns.amount > -1 ? parseAmount(row[columns.amount] ?? '') : (parseAmount(row[row.length - 1] ?? '') ?? 0);
        if (amount !== null) { if (amount < 0) credit = Math.abs(amount); else debit = amount; }
      }
    } else {
      // No header: infer the shape from the row itself.
      const dateColumn = row.findIndex((cell) => isDateCell(cell));
      const numbers = row.map((cell, index) => ({ index, value: parseAmount(cell) })).filter((item) => item.value !== null && item.index !== dateColumn) as Array<{ index: number; value: number }>;
      if (dateColumn > -1) date = String(row[dateColumn]).trim();
      description = row.filter((cell, index) => index !== dateColumn && parseAmount(cell) === null).join(' ').trim();
      if (numbers.length >= 2) {
        debit = numbers[0].value;
        credit = numbers[1].value;
        if (numbers.length >= 3) balance = numbers[numbers.length - 1].value;
      } else if (numbers.length === 1) {
        const amount = numbers[0].value;
        if (amount < 0) credit = Math.abs(amount); else debit = amount;
      }
    }

    const hasMoney = debit !== 0 || credit !== 0 || (balance !== null && balance !== 0);
    if (!hasMoney) { skipped += 1; continue; }
    if (!date && !description && !account) { skipped += 1; continue; }

    debitTotal += debit;
    creditTotal += credit;
    ledger.push({ date, description: description || account, account, debit, credit, balance });
  }

  return { ledger, columns: header, skipped, debitTotal, creditTotal, header };
}

const ASSET_WORDS = /cash|bank|receivable|debtor|inventory|stock|prepaid|equipment|furniture|motor|vehicle|property|land|building|goodwill|investment|deposit|current asset|non-current asset|fixed asset/i;
const LIABILITY_WORDS = /payable|creditor|accrual|loan|borrowing|overdraft|mortgage|lease liabilit|tax payable|vat payable|provision|deferred income|current liabilit|non-current liabilit/i;
const EQUITY_WORDS = /capital|equity|retained|drawings|dividend|owner|share|reserve/i;
const REVENUE_WORDS = /revenue|sales|turnover|income|fees? (earned|income)|commission|interest received|other income/i;
const EXPENSE_WORDS = /expense|cost of sales|salary|salar|wages?|payroll|rent|utilit|electric|water|internet|telephone|transport|fuel|travel|insurance|depreciation|amortisation|amortization|professional|audit fee|advertis|market|repair|maintenance|stationery|supplies|software|subscription|bank charge|interest (paid|expense)|training|licen[cs]e|permit|security|cleaning|catering|hospitality|printing|postage|courier|consult|subcontract|director/i;

type Section = 'assets' | 'liabilities' | 'equity' | 'revenue' | 'expenses';

/** Keyword-only classification, used when the document gives no Dr/Cr side. */
function classify(label: string): Section | null {
  const value = label.toLowerCase();
  if (!value.trim()) return null;
  if (EQUITY_WORDS.test(value)) return 'equity';
  if (LIABILITY_WORDS.test(value)) return 'liabilities';
  if (ASSET_WORDS.test(value)) return 'assets';
  if (REVENUE_WORDS.test(value)) return 'revenue';
  if (EXPENSE_WORDS.test(value)) return 'expenses';
  return null;
}

/**
 * Classification that respects which side of the ledger the balance sits on.
 * A credit balance cannot be an expense and a debit balance cannot be income,
 * so the side narrows the choice before the keywords refine it.
 */
function classifySide(label: string, isDebit: boolean): Section | null {
  const value = label.toLowerCase();
  if (!value.trim()) return null;
  if (isDebit) {
    if (EXPENSE_WORDS.test(value)) return 'expenses';
    if (ASSET_WORDS.test(value)) return 'assets';
    if (/fees|income|revenue|sales/i.test(value)) return 'expenses';
    return 'assets';
  }
  if (EQUITY_WORDS.test(value)) return 'equity';
  if (/fees|income|revenue|sales|turnover|commission/i.test(value)) return 'revenue';
  if (LIABILITY_WORDS.test(value)) return 'liabilities';
  if (REVENUE_WORDS.test(value)) return 'revenue';
  if (ASSET_WORDS.test(value)) return 'assets';
  return 'liabilities';
}

/**
 * Build a balance sheet from a trial balance shaped grid (Account | Debit |
 * Credit). Debit balances are assets or expenses, credit balances are
 * liabilities, equity or income.
 */
function statementsFromTrialBalance(grid: Grid): { statements: Statements; used: number } | null {
  const headerIndex = grid.findIndex((row) => looksLikeHeader(row) && row.join(' ').toLowerCase().includes('debit') && row.join(' ').toLowerCase().includes('credit'));
  if (headerIndex === -1) return null;
  const body = grid.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell).trim()));
  // A bank statement also has Debit and Credit columns but is dated per row;
  // a trial balance lists accounts, not transactions.
  const dated = body.filter((row) => row.some((cell) => isDateCell(cell))).length;
  if (dated > Math.max(2, body.length * 0.25)) return null;

  const header = normaliseHeader(grid[headerIndex]);
  const columns = mapColumns(header);
  const statements: Statements = { assets: [], liabilities: [], equity: [], revenue: [], expenses: [], totals: { assets: 0, liabilities: 0, equity: 0, revenue: 0, expenses: 0, netProfit: 0, balanceCheck: 0 } };
  let used = 0;

  for (const row of body) {
    const numberCells = row.map((cell) => parseAmount(cell));
    const label = row
      .filter((_cell, index) => numberCells[index] === null)
      .map((cell) => String(cell).trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const numbers = numberCells.filter((value): value is number => value !== null);
    if (!label || !numbers.length) continue;

    const debit = columns.debit > -1 ? (parseAmount(row[columns.debit] ?? '') ?? 0) : (numbers[0] ?? 0);
    const credit = columns.credit > -1 ? (parseAmount(row[columns.credit] ?? '') ?? 0) : (numbers[1] ?? 0);
    const net = debit - credit;
    if (net === 0) continue;

    const bucket = classifySide(label, net > 0);
    if (!bucket) continue;
    statements[bucket].push({ label, amount: Math.abs(net) });
    used += 1;
  }
  return used ? { statements, used } : null;
}

/**
 * Turn a ledger into statements. Without a chart of accounts we cannot split
 * a bank statement into a full double-entry balance sheet, so the statement is
 * built from what the document actually supports: cash movement, categorised
 * income and expenditure, and a balance-sheet view of the closing position.
 */
function statementsFromLedger(ledger: LedgerRow[], opening: number | null, currency: string): Statements {
  const statements: Statements = { assets: [], liabilities: [], equity: [], revenue: [], expenses: [], totals: { assets: 0, liabilities: 0, equity: 0, revenue: 0, expenses: 0, netProfit: 0, balanceCheck: 0 } };
  const buckets = new Map<string, number>();
  let revenue = 0;
  let expenses = 0;

  for (const row of ledger) {
    const description = `${row.account} ${row.description}`.trim();
    const signed = row.debit - row.credit;
    const bucket = classify(description);
    if (bucket === 'revenue') {
      // Money in from trading is credit; a refund is a debit against income.
      const value = -signed;
      revenue += value;
      buckets.set(description.split(/\s{2,}/)[0].slice(0, 60) || description.slice(0, 60), value);
    } else if (bucket === 'expenses') {
      const value = signed;
      expenses += value;
      buckets.set(description.split(/\s{2,}/)[0].slice(0, 60) || description.slice(0, 60), value);
    }
  }

  const netProfit = revenue - expenses;
  const closing = ledger.length ? ledger[ledger.length - 1].balance : null;
  const openingBalance = opening ?? (closing !== null && ledger.length ? closing - (revenue - expenses) : null);

  for (const [label, amount] of Array.from(buckets.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 25)) {
    if (amount >= 0) statements.expenses.push({ label, amount });
    else statements.revenue.push({ label, amount: -amount });
  }

  if (closing !== null) {
    statements.assets.push({ label: `${currency} account closing balance`, amount: closing, emphasis: true });
    if (openingBalance !== null && openingBalance !== closing) statements.equity.push({ label: 'Net movement for the period', amount: closing - openingBalance });
  }

  statements.totals = {
    assets: statements.assets.reduce((sum, line) => sum + line.amount, 0),
    liabilities: 0,
    equity: statements.equity.reduce((sum, line) => sum + line.amount, 0),
    revenue,
    expenses,
    netProfit,
    balanceCheck: (closing ?? 0) - ((openingBalance ?? 0) + netProfit),
  };
  return statements;
}

export function analyseDocument(grid: Grid, warnings: string[] = []): DocumentAnalysis {
  const currency = detectCurrency(grid);
  const trial = statementsFromTrialBalance(grid);
  const { ledger, columns, skipped, debitTotal, creditTotal, header } = extractLedger(grid);
  const allWarnings = [...warnings];

  if (!ledger.length && !trial) {
    allWarnings.push('No dated rows with amounts were found, so no financial statement could be calculated. If the figures are in the file, include a header row naming the Date, Description and Amount (or Debit/Credit) columns.');
  }
  if (trial) {
    const statements = trial.statements;
    statements.totals = {
      assets: statements.assets.reduce((sum, line) => sum + line.amount, 0),
      liabilities: statements.liabilities.reduce((sum, line) => sum + line.amount, 0),
      equity: statements.equity.reduce((sum, line) => sum + line.amount, 0),
      revenue: statements.revenue.reduce((sum, line) => sum + line.amount, 0),
      expenses: statements.expenses.reduce((sum, line) => sum + line.amount, 0),
      netProfit: 0,
      balanceCheck: 0,
    };
    statements.totals.netProfit = statements.totals.revenue - statements.totals.expenses;
    statements.totals.balanceCheck = statements.totals.assets - (statements.totals.liabilities + statements.totals.equity + statements.totals.netProfit);
    return {
      kind: 'trial-balance',
      currency,
      ledger: [],
      statements,
      diagnostics: { rowsRead: grid.length, rowsCounted: trial.used, rowsSkipped: Math.max(0, grid.length - trial.used - 1), openingBalance: null, closingBalance: null, debitTotal, creditTotal, balanceDifference: Number((debitTotal - creditTotal).toFixed(2)), columns: header },
      warnings: allWarnings,
    };
  }

  const openingRow = grid.find((row) => /opening balance|balance b\/?f|brought forward/i.test(row.join(' ')));
  const opening = openingRow ? (parseAmount(openingRow.join(' ').replace(/opening balance|balance b\/?f|brought forward/gi, '')) ?? null) : null;
  const statements = statementsFromLedger(ledger, opening, currency);
  const closing = ledger.length ? ledger[ledger.length - 1].balance : null;
  const balanceDifference = Number((creditTotal - debitTotal - (opening !== null && closing !== null ? closing - opening : 0)).toFixed(2));

  if (columns.length && findColumn(columns, /debit/i) === -1 && findColumn(columns, /credit/i) === -1) {
    allWarnings.push('This document has a single amount column rather than separate debit and credit columns, so income and expenditure were classified from the descriptions.');
  }
  const unattributed = ledger.filter((row) => !classify(`${row.account} ${row.description}`)).length;
  if (ledger.length && unattributed > ledger.length * 0.3) {
    allWarnings.push(`${unattributed} of ${ledger.length} rows did not match a standard account type and are reported as unattributed rather than guessed.`);
  }
  if (closing !== null && statements.totals.balanceCheck !== 0 && Math.abs(statements.totals.balanceCheck) > 1) {
    allWarnings.push(`The calculated movement does not reconcile exactly to the closing balance (difference ${statements.totals.balanceCheck.toLocaleString(undefined, { maximumFractionDigits: 2 })}). The document is probably incomplete or spans a different period than its opening balance.`);
  }

  return {
    kind: trial ? 'trial-balance' : ledger.length ? 'ledger' : 'unknown',
    currency,
    ledger,
    statements,
    diagnostics: {
      rowsRead: grid.length,
      rowsCounted: ledger.length,
      rowsSkipped: skipped,
      openingBalance: opening,
      closingBalance: closing,
      debitTotal,
      creditTotal,
      balanceDifference,
      columns: header,
    },
    warnings: allWarnings,
  };
}
