import type { DocumentExtraction } from './extended-types';

let extraction: DocumentExtraction = { id: 'extract-demo-bank', filename: 'Fictional ABC Holdings bank statement.csv', status: 'Needs Review', summary: 'A fictional September 2026 bank statement with three extracted transactions. Review is required before any accounting record is created.', transactions: [{ date: '2026-09-12', description: 'Client receipt — ABC Holdings Ltd', debit: 250000, credit: 0 }, { date: '2026-09-15', description: 'Office rent payment', debit: 0, credit: 95000 }, { date: '2026-09-25', description: 'Staff costs payment', debit: 0, credit: 310000 }], totalDebits: 250000, totalCredits: 405000, unusualItems: ['Net cash movement is negative for the extracted sample; confirm the opening balance and statement period.'] };

export function getDocumentExtraction() { return extraction; }
export function approveDocumentExtraction() { extraction = { ...extraction, status: 'Approved' }; return extraction; }
