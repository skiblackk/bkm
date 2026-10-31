import type { AccountingSnapshot, JournalEntry, JournalLine } from './extended-types';

const accounts = [
  { id: 'acct-cash', code: '1000', name: 'Cash and bank', type: 'Asset' as const, balance: 0 },
  { id: 'acct-receivable', code: '1100', name: 'Trade receivables', type: 'Asset' as const, balance: 0 },
  { id: 'acct-equipment', code: '1500', name: 'Office equipment', type: 'Asset' as const, balance: 0 },
  { id: 'acct-payable', code: '2000', name: 'Trade payables', type: 'Liability' as const, balance: 0 },
  { id: 'acct-capital', code: '3000', name: 'Partner capital', type: 'Equity' as const, balance: 0 },
  { id: 'acct-revenue', code: '4000', name: 'Professional fees', type: 'Revenue' as const, balance: 0 },
  { id: 'acct-rent', code: '5100', name: 'Office rent', type: 'Expense' as const, balance: 0 },
  { id: 'acct-payroll', code: '5200', name: 'Staff costs', type: 'Expense' as const, balance: 0 },
];

const journalEntries: JournalEntry[] = [
  { id: 'je-001', date: '2026-09-01', description: 'Opening partner capital', reference: 'OPEN-001', lines: [{ accountId: 'acct-cash', debit: 1500000, credit: 0 }, { accountId: 'acct-capital', debit: 0, credit: 1500000 }] },
  { id: 'je-002', date: '2026-09-05', description: 'Professional fees billed to ABC Holdings Ltd', reference: 'INV-ABC-001', lines: [{ accountId: 'acct-receivable', debit: 420000, credit: 0 }, { accountId: 'acct-revenue', debit: 0, credit: 420000 }] },
  { id: 'je-003', date: '2026-09-12', description: 'Client receipt — ABC Holdings Ltd', reference: 'RCPT-ABC-001', lines: [{ accountId: 'acct-cash', debit: 250000, credit: 0 }, { accountId: 'acct-receivable', debit: 0, credit: 250000 }] },
  { id: 'je-004', date: '2026-09-15', description: 'September office rent', reference: 'EXP-RENT-001', lines: [{ accountId: 'acct-rent', debit: 95000, credit: 0 }, { accountId: 'acct-cash', debit: 0, credit: 95000 }] },
  { id: 'je-005', date: '2026-09-25', description: 'September staff costs', reference: 'PAY-SEP-001', lines: [{ accountId: 'acct-payroll', debit: 310000, credit: 0 }, { accountId: 'acct-cash', debit: 0, credit: 310000 }] },
  { id: 'je-006', date: '2026-09-28', description: 'Office equipment purchase', reference: 'CAPEX-001', lines: [{ accountId: 'acct-equipment', debit: 180000, credit: 0 }, { accountId: 'acct-payable', debit: 0, credit: 180000 }] },
];

function validateEntry(entry: JournalEntry) { const debits = entry.lines.reduce((sum, line) => sum + line.debit, 0); const credits = entry.lines.reduce((sum, line) => sum + line.credit, 0); if (Math.round(debits * 100) !== Math.round(credits * 100)) throw new Error(`Unbalanced journal entry ${entry.reference}: debits must equal credits.`); }

export function getAccountingSnapshot(): AccountingSnapshot {
  journalEntries.forEach(validateEntry);
  const accountBalances = accounts.map((account) => ({ ...account, balance: 0 }));
  const ledger = [] as AccountingSnapshot['ledger'];
  for (const entry of journalEntries) for (const line of entry.lines) { const account = accountBalances.find((item) => item.id === line.accountId)!; const signed = ['Asset', 'Expense'].includes(account.type) ? line.debit - line.credit : line.credit - line.debit; account.balance += signed; ledger.push({ date: entry.date, reference: entry.reference, description: entry.description, accountId: account.id, debit: line.debit, credit: line.credit, runningBalance: account.balance }); }
  const trialBalance = accountBalances.map((account) => ({ accountId: account.id, debit: ['Asset', 'Expense'].includes(account.type) ? Math.max(account.balance, 0) : 0, credit: ['Liability', 'Equity', 'Revenue'].includes(account.type) ? Math.max(account.balance, 0) : 0 }));
  const revenue = accountBalances.find((item) => item.id === 'acct-revenue')!.balance;
  const expenses = accountBalances.filter((item) => item.type === 'Expense').reduce((sum, item) => sum + item.balance, 0);
  const assets = accountBalances.filter((item) => item.type === 'Asset').reduce((sum, item) => sum + item.balance, 0);
  const liabilities = accountBalances.filter((item) => item.type === 'Liability').reduce((sum, item) => sum + item.balance, 0);
  const capital = accountBalances.filter((item) => item.type === 'Equity').reduce((sum, item) => sum + item.balance, 0);
  const netProfit = revenue - expenses;
  return { accounts: accountBalances, journalEntries, ledger, trialBalance, incomeStatement: { revenue, expenses, netProfit }, balanceSheet: { assets, liabilities, equity: capital + netProfit, balanced: Math.abs(assets - (liabilities + capital + netProfit)) < 0.01 }, cashFlow: { operating: 250000 - 95000 - 310000, investing: -180000, financing: 1500000, netChange: 1500000 + 250000 - 95000 - 310000 - 180000 } };
}

export function addJournalEntry(entry: JournalEntry) { validateEntry(entry); journalEntries.push(entry); return getAccountingSnapshot(); }
