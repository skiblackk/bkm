export type AttendanceStatus = 'Present' | 'Late' | 'Not Checked In' | 'Approved Leave' | 'Remote Work' | 'Field Work' | 'Missing Check-out';
export type AttendanceException = 'Approved Leave' | 'Official Field Work' | 'Remote Work' | 'Approved Absence' | 'Public Holiday' | 'Weekend';

export interface AttendanceRecord {
  id: string;
  staffId: string;
  date: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  durationMinutes: number | null;
}

export interface AccountingAccount { id: string; code: string; name: string; type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense'; balance: number; }
export interface JournalLine { accountId: string; debit: number; credit: number; }
export interface JournalEntry { id: string; date: string; description: string; reference: string; lines: JournalLine[]; }
export interface LedgerLine { date: string; reference: string; description: string; accountId: string; debit: number; credit: number; runningBalance: number; }
export interface DocumentExtraction { id: string; filename: string; status: 'Needs Review' | 'Approved'; summary: string; transactions: { date: string; description: string; debit: number; credit: number }[]; totalDebits: number; totalCredits: number; unusualItems: string[]; }

export interface AccountingSnapshot {
  accounts: AccountingAccount[];
  journalEntries: JournalEntry[];
  ledger: LedgerLine[];
  trialBalance: { accountId: string; debit: number; credit: number }[];
  incomeStatement: { revenue: number; expenses: number; netProfit: number };
  balanceSheet: { assets: number; liabilities: number; equity: number; balanced: boolean };
  cashFlow: { operating: number; investing: number; financing: number; netChange: number };
}
