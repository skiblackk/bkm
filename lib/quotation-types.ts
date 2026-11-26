/**
 * Shapes shared by the quotation API and the client component.
 * Kept free of server imports so the component can import the types alone.
 */

export type QuotationStatus = 'Draft' | 'Sent' | 'Viewed' | 'Accepted' | 'Rejected' | 'Expired';

export type QuotationLineView = {
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

export type QuotationView = {
  id: string;
  number: string;
  revision: number;
  status: QuotationStatus;
  service: string;
  description: string;
  clientId: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  currency: string;
  issueDate: string;
  validUntil: string;
  subtotal: number;
  discountTotal: number;
  taxLabel: string;
  taxRate: number;
  taxTotal: number;
  total: number;
  paymentTerms: string;
  notes: string;
  acceptanceInstructions: string;
  lines: QuotationLineView[];
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  hasPdf: boolean;
  shareUrl: string;
  contacts: { id: string; name: string; email: string; phone: string }[];
  events: { from: string | null; to: string; channel: string; detail: string | null; actor: string | null; at: string; atLabel: string }[];
  shares: { channel: string; recipient: string | null; subject: string | null; at: string; atLabel: string; actor: string | null }[];
  invoice: { id: string; number: string; status: string; total: number; issueDate: string | null } | null;
  createdAt: string | null;
};

export const STATUS_TONE: Record<QuotationStatus, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Sent: 'bg-amber-50 text-amber-700',
  Viewed: 'bg-sky-50 text-sky-700',
  Accepted: 'bg-emerald-50 text-emerald-700',
  Rejected: 'bg-red-50 text-red-700',
  Expired: 'bg-stone-100 text-stone-500',
};
