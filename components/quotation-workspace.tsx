'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Ban, Check, CheckCircle2, Clock3, Copy, Download, Eye, FileText,
  Loader2, Mail, MessageCircle, Plus, ReceiptText, RefreshCw, Send, Trash2, X, XCircle,
} from 'lucide-react';
import type { QuotationStatus, QuotationView } from '@/lib/quotation-types';
import { STATUS_TONE } from '@/lib/quotation-types';

type ClientOption = { id: string; name: string; contactName?: string; contactEmail?: string; contactPhone?: string };

type DraftLine = { key: string; description: string; quantity: string; unitPrice: string; discountPct: string; taxRate: string };

const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value || 0)}`;

const newLine = (description = '', unitPrice = '0'): DraftLine => ({
  key: `line-${Math.random().toString(36).slice(2, 9)}`,
  description,
  quantity: '1',
  unitPrice,
  discountPct: '0',
  taxRate: '',
});

const STATUS_ORDER: QuotationStatus[] = ['Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected', 'Expired'];

function StatusPill({ status }: { status: QuotationStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${STATUS_TONE[status]}`}>{status}</span>;
}

function Section({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          {eyebrow ? <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div> : null}
          <h3 className="mt-0.5 text-sm font-semibold text-navy">{title}</h3>
        </div>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export default function QuotationWorkspace({ clients }: { clients: ClientOption[] }) {
  const [quotations, setQuotations] = useState<QuotationView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState<'all' | QuotationStatus>('all');
  const [mode, setMode] = useState<'detail' | 'new'>('detail');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Builder state
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [service, setService] = useState('Audit & Assurance');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine('Statutory audit — annual engagement', '180000')]);
  const [validDays, setValidDays] = useState('30');
  const [taxRate, setTaxRate] = useState('16');
  const [paymentTerms, setPaymentTerms] = useState('Payable within 30 days of invoice. Bank transfer or cheque in favour of BKM Associates.');
  const [notes, setNotes] = useState('All amounts are quoted in Kenyan Shillings. Fees exclude disbursements unless stated.');

  // Delivery state
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waMessage, setWaMessage] = useState('');
  const [waLink, setWaLink] = useState('');
  const [panel, setPanel] = useState<'none' | 'email' | 'whatsapp' | 'decision'>('none');
  const [decidedBy, setDecidedBy] = useState('');
  const [decisionNote, setDecisionNote] = useState('');

  const selected = useMemo(() => quotations.find((item) => item.id === selectedId) ?? null, [quotations, selectedId]);

  const load = useCallback(async (keep?: string | null) => {
    const response = await fetch('/api/quotations', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice({ tone: 'error', text: payload.error ?? 'Quotations could not be loaded.' });
      setLoading(false);
      return;
    }
    const list: QuotationView[] = payload.quotations ?? [];
    setQuotations(list);
    setSelectedId((current) => {
      const wanted = keep ?? current;
      if (wanted && list.some((item) => item.id === wanted)) return wanted;
      return list[0]?.id ?? null;
    });
    if (Array.isArray(payload.expired) && payload.expired.length) {
      setNotice({ tone: 'warn', text: `${payload.expired.length} quotation${payload.expired.length === 1 ? '' : 's'} passed the validity date and are now marked Expired.` });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedKey = `${selected?.id ?? ''}:${selected?.number ?? ''}`;
  useEffect(() => {
    if (!selected) return;
    setEmailTo(selected.contactEmail ?? '');
    setEmailSubject(`Quotation ${selected.number} — ${selected.service}`);
    setEmailBody('');
    setWaPhone(selected.contactPhone ?? '');
    setWaMessage('');
    setWaLink('');
    setDecidedBy(selected.contactName ?? '');
    setDecisionNote('');
    setPanel('none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const act = async (body: Record<string, unknown>, successPrefix?: string) => {
    setBusy(String(body.action));
    setNotice(null);
    try {
      const response = await fetch('/api/quotations/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice({ tone: 'error', text: payload.error ?? 'That action could not be completed.' });
        return null;
      }
      if (Array.isArray(payload.quotations)) {
        setQuotations(payload.quotations);
        const next = payload.quotation?.id ?? (body.id as string | undefined) ?? null;
        if (next) setSelectedId(next);
      }
      if (payload.message) setNotice({ tone: 'ok', text: `${successPrefix ? `${successPrefix} ` : ''}${payload.message}` });
      return payload;
    } catch {
      setNotice({ tone: 'error', text: 'The request could not reach the server. Check the connection and try again.' });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const draftPricing = useMemo(() => {
    const fallback = Number(taxRate || 0);
    const priced = lines.map((line) => {
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.unitPrice || 0);
      const discountPct = Number(line.discountPct || 0);
      const rate = line.taxRate === '' ? fallback : Number(line.taxRate || 0);
      const subtotal = quantity * unitPrice;
      const discount = subtotal * (discountPct / 100);
      const tax = (subtotal - discount) * (rate / 100);
      return { subtotal, discount, tax, total: subtotal - discount + tax };
    });
    return {
      subtotal: priced.reduce((sum, row) => sum + row.subtotal, 0),
      discountTotal: priced.reduce((sum, row) => sum + row.discount, 0),
      taxTotal: priced.reduce((sum, row) => sum + row.tax, 0),
      total: priced.reduce((sum, row) => sum + row.total, 0),
    };
  }, [lines, taxRate]);

  const submitDraft = async () => {
    const payload = {
      action: editingId ? 'update' : 'create',
      ...(editingId ? { id: editingId } : {}),
      clientId,
      service,
      description,
      lines: lines
        .filter((line) => line.description.trim())
        .map((line) => ({
          description: line.description.trim(),
          quantity: Number(line.quantity || 0),
          unitPrice: Number(line.unitPrice || 0),
          discountPct: Number(line.discountPct || 0),
          taxRate: line.taxRate === '' ? Number(taxRate || 0) : Number(line.taxRate),
        })),
      taxRate: Number(taxRate || 0),
      validUntil: new Date(Date.now() + Number(validDays || 30) * 86400000).toISOString().slice(0, 10),
      paymentTerms,
      notes,
    };
    const result = await act(payload);
    if (result) {
      setMode('detail');
      setEditingId(null);
      setLines([newLine('Statutory audit — annual engagement', '180000')]);
      setDescription('');
    }
  };

  const openEditor = (quotation: QuotationView) => {
    setEditingId(quotation.id);
    setClientId(quotation.clientId);
    setService(quotation.service);
    setDescription(quotation.description ?? '');
    setPaymentTerms(quotation.paymentTerms ?? '');
    setNotes(quotation.notes ?? '');
    setTaxRate(String(quotation.taxRate ?? 0));
    setLines(quotation.lines.map((line) => ({
      key: `line-${Math.random().toString(36).slice(2, 9)}`,
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      discountPct: String(line.discountPct ?? 0),
      taxRate: String(line.taxRate ?? quotation.taxRate ?? 0),
    })));
    setMode('new');
  };

  const filtered = filter === 'all' ? quotations : quotations.filter((item) => item.status === filter);
  const counts = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = quotations.filter((item) => item.status === status).length;
    return acc;
  }, {} as Record<QuotationStatus, number>);

  const downloadPdf = async (quotation: QuotationView, inline = false) => {
    setBusy('download');
    try {
      const response = await fetch(`/api/quotations/pdf?id=${quotation.id}${inline ? '&mode=inline' : ''}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setNotice({ tone: 'error', text: payload.error ?? 'The PDF could not be produced.' });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (inline) {
        window.open(url, '_blank', 'noopener');
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${quotation.number}-rev${quotation.revision}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      setNotice({ tone: 'ok', text: `${quotation.number} PDF ${inline ? 'opened' : 'downloaded'} and stored against the quotation record.` });
      void load(quotation.id);
    } finally {
      setBusy(null);
    }
  };

  const startWhatsapp = async () => {
    if (!selected) return;
    const payload = await act({ action: 'whatsapp', id: selected.id, phone: waPhone, message: waMessage });
    if (payload?.whatsapp?.link) {
      setWaLink(payload.whatsapp.link);
      const opened = window.open(payload.whatsapp.link, '_blank');
      if (opened) opened.opener = null;
    }
  };

  const sendEmail = async () => {
    if (!selected) return;
    const payload = await act({ action: 'email', id: selected.id, to: emailTo, subject: emailSubject, body: emailBody });
    if (payload?.email && !payload.email.delivered) {
      setEmailBody(payload.email.body ?? '');
    }
    if (payload) void load(selected.id);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Commercial workflow</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-navy">Quotations</h1>
          <p className="mt-1 text-xs text-slate-500">
            Prepare, issue, track and convert client quotations. Every issued revision and its PDF is kept exactly as the client received it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load(selectedId)} disabled={busy !== null} className="flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-navy hover:border-gold disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </button>
          <button
            onClick={() => {
              if (mode === 'new') { setMode('detail'); setEditingId(null); }
              else { setEditingId(null); setService('Audit & Assurance'); setDescription(''); setLines([newLine('Statutory audit — annual engagement', '180000')]); setMode('new'); }
            }}
            className="flex h-9 items-center gap-2 rounded-md bg-navy px-3.5 text-xs font-semibold text-white hover:bg-navy/90"
          >
            {mode === 'new' ? <X size={14} /> : <Plus size={14} />} {mode === 'new' ? 'Close builder' : 'New quotation'}
          </button>
        </div>
      </div>

      {notice ? (
        <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-xs leading-5 ${
          notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : notice.tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-red-200 bg-red-50 text-red-900'
        }`}>
          {notice.tone === 'ok' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : notice.tone === 'warn' ? <Clock3 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100"><X size={13} /></button>
        </div>
      ) : null}

      {mode === 'new' ? (
        <Section title={editingId ? 'Edit the draft' : 'New quotation'} eyebrow="Builder" action={<span className="text-[11px] text-slate-400">{editingId ? 'Changes are saved to the draft only — the issued document is untouched' : 'Saved as a draft — nothing is sent until you issue it'}</span>}>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Client</span>
              <select value={clientId} onChange={(event) => setClientId(event.target.value)} className="field">
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Service</span>
              <select value={service} onChange={(event) => setService(event.target.value)} className="field">
                <option>Audit &amp; Assurance</option>
                <option>Accounting &amp; Bookkeeping</option>
                <option>Tax Consultation &amp; Compliance</option>
                <option>Financial Advisory</option>
                <option>Transfer Pricing</option>
                <option>Payroll Compliance</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Scope of engagement</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="One or two lines describing what is being delivered." className="field min-h-[64px]" />
          </label>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-line text-[9px] uppercase tracking-[0.12em] text-slate-400">
                  <th className="pb-2 text-left font-bold">Description</th>
                  <th className="w-16 pb-2 text-right font-bold">Qty</th>
                  <th className="w-32 pb-2 text-right font-bold">Unit price</th>
                  <th className="w-20 pb-2 text-right font-bold">Disc %</th>
                  <th className="w-20 pb-2 text-right font-bold">Tax %</th>
                  <th className="w-32 pb-2 text-right font-bold">Amount</th>
                  <th className="w-8 pb-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const amount = (Number(line.quantity || 0) * Number(line.unitPrice || 0));
                  const rate = line.taxRate === '' ? Number(taxRate || 0) : Number(line.taxRate || 0);
                  const total = amount - amount * (Number(line.discountPct || 0) / 100) + (amount - amount * (Number(line.discountPct || 0) / 100)) * (rate / 100);
                  return (
                    <tr key={line.key} className="border-b border-line/70">
                      <td className="py-1.5 pr-2"><input value={line.description} onChange={(event) => setLines((rows) => rows.map((row) => row.key === line.key ? { ...row, description: event.target.value } : row))} placeholder="What is being delivered" className="w-full rounded border border-line px-2 py-1.5 text-xs outline-none focus:border-teal-500" /></td>
                      <td className="py-1.5 pr-2"><input type="number" min="0" value={line.quantity} onChange={(event) => setLines((rows) => rows.map((row) => row.key === line.key ? { ...row, quantity: event.target.value } : row))} className="w-full rounded border border-line px-2 py-1.5 text-right text-xs tabular outline-none focus:border-teal-500" /></td>
                      <td className="py-1.5 pr-2"><input type="number" min="0" value={line.unitPrice} onChange={(event) => setLines((rows) => rows.map((row) => row.key === line.key ? { ...row, unitPrice: event.target.value } : row))} className="w-full rounded border border-line px-2 py-1.5 text-right text-xs tabular outline-none focus:border-teal-500" /></td>
                      <td className="py-1.5 pr-2"><input type="number" min="0" max="100" value={line.discountPct} onChange={(event) => setLines((rows) => rows.map((row) => row.key === line.key ? { ...row, discountPct: event.target.value } : row))} className="w-full rounded border border-line px-2 py-1.5 text-right text-xs tabular outline-none focus:border-teal-500" /></td>
                      <td className="py-1.5 pr-2"><input type="number" min="0" max="100" value={line.taxRate} placeholder={taxRate} onChange={(event) => setLines((rows) => rows.map((row) => row.key === line.key ? { ...row, taxRate: event.target.value } : row))} className="w-full rounded border border-line px-2 py-1.5 text-right text-xs tabular outline-none focus:border-teal-500" /></td>
                      <td className="py-1.5 pr-2 text-right text-xs font-semibold tabular text-navy">{money('KES', Math.round(total))}</td>
                      <td className="py-1.5 text-right">
                        <button onClick={() => setLines((rows) => rows.length > 1 ? rows.filter((row) => row.key !== line.key) : rows)} className="text-slate-300 hover:text-red-600" aria-label={`Remove line ${index + 1}`}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button onClick={() => setLines((rows) => [...rows, newLine()])} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-navy hover:text-gold">
            <Plus size={12} /> Add line
          </button>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Payment terms</span>
                <textarea value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} className="field min-h-[56px]" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Notes</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="field min-h-[48px]" />
              </label>
            </div>
            <div className="rounded-lg border border-line bg-canvas p-4">
              <div className="flex items-center justify-between text-[11px] text-slate-500"><span>Subtotal</span><span className="tabular">{money('KES', Math.round(draftPricing.subtotal))}</span></div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500"><span>Discount</span><span className="tabular">({money('KES', Math.round(draftPricing.discountTotal))})</span></div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500"><span>VAT</span><span className="tabular">{money('KES', Math.round(draftPricing.taxTotal))}</span></div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm font-bold text-navy"><span>Total</span><span className="tabular">{money('KES', Math.round(draftPricing.total))}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">VAT %</span>
                  <input type="number" min="0" max="100" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} className="w-full rounded border border-line px-2 py-1.5 text-xs tabular outline-none focus:border-teal-500" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Valid (days)</span>
                  <input type="number" min="1" max="365" value={validDays} onChange={(event) => setValidDays(event.target.value)} className="w-full rounded border border-line px-2 py-1.5 text-xs tabular outline-none focus:border-teal-500" />
                </label>
              </div>
              <button onClick={() => void submitDraft()} disabled={busy !== null || !clientId || !lines.some((line) => line.description.trim())} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-navy px-4 py-2.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
                {busy === 'create' || busy === 'update' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {editingId ? 'Save changes' : 'Save draft'}
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        {/* ---------------------------------------------------------- register */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setFilter('all')} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${filter === 'all' ? 'bg-navy text-white' : 'bg-white text-slate-500 border border-line'}`}>
              All {quotations.length}
            </button>
            {STATUS_ORDER.map((status) => (
              <button key={status} onClick={() => setFilter(status)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${filter === status ? 'bg-navy text-white' : 'bg-white text-slate-500 border border-line'}`}>
                {status} {counts[status] ?? 0}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-white">
            {loading ? (
              <div className="flex items-center gap-2 px-5 py-10 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading quotations…</div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <FileText size={20} className="mx-auto text-slate-300" />
                <p className="mt-2 text-xs text-slate-500">No {filter === 'all' ? '' : `${filter.toLowerCase()} `}quotations yet.</p>
              </div>
            ) : filtered.map((quotation) => (
              <button
                key={quotation.id}
                onClick={() => { setSelectedId(quotation.id); setMode('detail'); }}
                className={`flex w-full items-start justify-between gap-3 border-b border-line px-4 py-3 text-left transition last:border-0 ${selectedId === quotation.id ? 'bg-canvas' : 'hover:bg-canvas/60'}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-navy">{quotation.number}</span>
                    <span className="text-[10px] text-slate-400">rev {quotation.revision}</span>
                    {quotation.invoice ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{quotation.invoice.number}</span> : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">{quotation.clientName}</div>
                  <div className="truncate text-[10px] text-slate-400">{quotation.service}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-semibold tabular text-navy">{money(quotation.currency, quotation.total)}</div>
                  <div className="mt-1"><StatusPill status={quotation.status} /></div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------ detail */}
        {selected ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-[-0.03em] text-navy">{selected.number}</h2>
                    <StatusPill status={selected.status} />
                    <span className="text-[10px] text-slate-400">revision {selected.revision}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{selected.clientName} · {selected.service}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Issued {selected.issueDate} · Valid until {selected.validUntil}</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Total</div>
                  <div className="text-xl font-bold tabular text-navy">{money(selected.currency, selected.total)}</div>
                </div>
              </div>

              {/* action bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-5 py-3">
                <button onClick={() => void downloadPdf(selected)} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-2 text-[11px] font-bold text-white hover:bg-navy/90 disabled:opacity-50">
                  {busy === 'download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
                </button>
                <button onClick={() => void downloadPdf(selected, true)} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-gold disabled:opacity-50">
                  <Eye size={13} /> Preview
                </button>
                {selected.status === 'Draft' ? (
                  <button onClick={() => openEditor(selected)} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-gold">
                    <FileText size={13} /> Edit draft
                  </button>
                ) : null}
                {selected.status === 'Draft' ? (
                  <button onClick={() => void act({ action: 'issue', id: selected.id })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-[11px] font-bold text-white hover:bg-teal-600 disabled:opacity-50">
                    {busy === 'issue' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Issue quotation
                  </button>
                ) : null}
                <button onClick={() => setPanel(panel === 'email' ? 'none' : 'email')} disabled={selected.status === 'Draft'} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-gold disabled:opacity-40">
                  <Mail size={13} /> Email
                </button>
                <button onClick={() => setPanel(panel === 'whatsapp' ? 'none' : 'whatsapp')} disabled={selected.status === 'Draft'} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-gold disabled:opacity-40">
                  <MessageCircle size={13} /> WhatsApp
                </button>
                <button onClick={() => { void navigator.clipboard.writeText(selected.shareUrl); setNotice({ tone: 'ok', text: 'Client link copied. Opening it marks the quotation Viewed.' }); }} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-gold">
                  <Copy size={13} /> Link
                </button>
                {(selected.status === 'Sent' || selected.status === 'Viewed') ? (
                  <button onClick={() => setPanel(panel === 'decision' ? 'none' : 'decision')} className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-2 text-[11px] font-bold text-white hover:bg-navy/90">
                    <Check size={13} /> Record decision
                  </button>
                ) : null}
                {selected.status === 'Accepted' && !selected.invoice ? (
                  <button onClick={() => void act({ action: 'convert', id: selected.id })} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-600 disabled:opacity-50">
                    {busy === 'convert' ? <Loader2 size={13} className="animate-spin" /> : <ReceiptText size={13} />} Convert to invoice
                  </button>
                ) : null}
                {selected.invoice ? (
                  <span className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">
                    <ReceiptText size={13} /> {selected.invoice.number} · {selected.invoice.status}
                  </span>
                ) : null}
              </div>

              {/* email panel */}
              {panel === 'email' ? (
                <div className="border-b border-line px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">Send by email</div>
                  <div className="mt-2 space-y-2">
                    <input value={emailTo} onChange={(event) => setEmailTo(event.target.value)} placeholder="client@example.com" className="field" />
                    <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} placeholder="Subject" className="field" />
                    <textarea value={emailBody} onChange={(event) => setEmailBody(event.target.value)} placeholder="Leave blank to use the prepared message." className="field min-h-[90px]" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button onClick={() => void sendEmail()} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-2 text-[11px] font-bold text-white hover:bg-navy/90 disabled:opacity-50">
                      {busy === 'email' ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Send with PDF attached
                    </button>
                    <button onClick={() => { setEmailBody(emailBody || `Dear ${selected.contactName || selected.clientName},\n\nPlease find attached quotation ${selected.number} for ${selected.service}.\n\nKind regards,\nBKM Associates`); }} className="text-[11px] font-semibold text-slate-500 hover:text-navy">Fill prepared message</button>
                  </div>
                </div>
              ) : null}

              {/* whatsapp panel */}
              {panel === 'whatsapp' ? (
                <div className="border-b border-line px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">Share by WhatsApp</div>
                  <div className="mt-2 space-y-2">
                    <input value={waPhone} onChange={(event) => setWaPhone(event.target.value)} placeholder="+254 7xx xxx xxx" className="field" />
                    <textarea value={waMessage} onChange={(event) => setWaMessage(event.target.value)} placeholder="Leave blank to use the prepared message." className="field min-h-[80px]" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button onClick={() => void startWhatsapp()} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md bg-[#1faa53] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#188f45] disabled:opacity-50">
                      {busy === 'whatsapp' ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} Open WhatsApp
                    </button>
                    <button onClick={() => void downloadPdf(selected)} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-gold">
                      <Download size={13} /> Download PDF to attach
                    </button>
                    {waLink ? <a href={waLink} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-teal-700 underline">Reopen WhatsApp</a> : null}
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-slate-400">WhatsApp opens with the client number and message filled in. Attach the downloaded PDF in the chat — WhatsApp cannot attach a file from a link.</p>
                </div>
              ) : null}

              {/* decision panel */}
              {panel === 'decision' ? (
                <div className="border-b border-line px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">Client decision</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input value={decidedBy} onChange={(event) => setDecidedBy(event.target.value)} placeholder="Decided by (client contact)" className="field" />
                    <input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Note — e.g. PO number, reason" className="field" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={() => { void act({ action: 'decide', id: selected.id, decision: 'Accepted', decidedBy, note: decisionNote, convert: true }); setPanel('none'); }} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-600 disabled:opacity-50">
                      {busy === 'decide' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accept &amp; raise invoice
                    </button>
                    <button onClick={() => { void act({ action: 'decide', id: selected.id, decision: 'Accepted', decidedBy, note: decisionNote }); setPanel('none'); }} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                      <Check size={13} /> Accept only
                    </button>
                    <button onClick={() => { void act({ action: 'decide', id: selected.id, decision: 'Rejected', decidedBy, note: decisionNote }); setPanel('none'); }} disabled={busy !== null} className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
                      <X size={13} /> Record rejection
                    </button>
                  </div>
                </div>
              ) : null}

              {/* line items */}
              <div className="px-5 py-4">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line text-[9px] uppercase tracking-[0.12em] text-slate-400">
                      <th className="pb-2 text-left font-bold">Description</th>
                      <th className="w-14 pb-2 text-right font-bold">Qty</th>
                      <th className="w-24 pb-2 text-right font-bold">Unit</th>
                      <th className="w-16 pb-2 text-right font-bold">Disc</th>
                      <th className="w-28 pb-2 text-right font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line, index) => (
                      <tr key={index} className="border-b border-line/60">
                        <td className="py-2 pr-2 text-xs font-semibold text-navy">{line.description}</td>
                        <td className="py-2 text-right text-xs tabular text-slate-500">{line.quantity}</td>
                        <td className="py-2 text-right text-xs tabular text-slate-500">{money(selected.currency, line.unitPrice)}</td>
                        <td className="py-2 text-right text-xs tabular text-slate-500">{line.discountPct ? `${line.discountPct}%` : '—'}</td>
                        <td className="py-2 text-right text-xs font-semibold tabular text-navy">{money(selected.currency, line.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex justify-end">
                  <div className="w-56 space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular">{money(selected.currency, selected.subtotal)}</span></div>
                    <div className="flex justify-between text-slate-500"><span>Discount</span><span className="tabular">({money(selected.currency, selected.discountTotal)})</span></div>
                    <div className="flex justify-between text-slate-500"><span>{selected.taxLabel} {selected.taxRate ? `(${selected.taxRate}%)` : ''}</span><span className="tabular">{money(selected.currency, selected.taxTotal)}</span></div>
                    <div className="flex justify-between border-t border-line pt-1.5 text-sm font-bold text-navy"><span>Total</span><span className="tabular">{money(selected.currency, selected.total)}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* tracking */}
            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Status history" eyebrow="Tracking">
                <ol className="space-y-2.5">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                    <div>
                      <div className="text-[11px] font-semibold text-navy">Draft prepared</div>
                      <div className="text-[10px] text-slate-400">{selected.createdAt ? new Date(selected.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' }) : '—'}</div>
                    </div>
                  </li>
                  {selected.events.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="flex items-start gap-2">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${event.to === 'Accepted' ? 'bg-emerald-500' : event.to === 'Rejected' ? 'bg-red-500' : event.to === 'Expired' ? 'bg-stone-400' : 'bg-gold'}`} />
                      <div>
                        <div className="text-[11px] font-semibold text-navy">
                          {event.from && event.from !== event.to ? `${event.from} → ${event.to}` : event.from ? `${event.to} updated` : event.to}
                          <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500">{event.channel}</span>
                        </div>
                        {event.detail ? <div className="text-[10px] leading-4 text-slate-500">{event.detail}</div> : null}
                        <div className="text-[10px] text-slate-400">{event.atLabel}{event.actor ? ` · ${event.actor}` : ''}</div>
                      </div>
                    </li>
                  ))}
                </ol>
                {selected.decisionNote ? (
                  <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-[10px] leading-4 text-slate-600">
                    <strong className="font-bold text-navy">Client note:</strong> {selected.decisionNote}
                  </div>
                ) : null}
              </Section>

              <Section title="Delivery record" eyebrow="Sent to the client">
                {selected.shares.length === 0 ? (
                  <p className="text-[11px] leading-5 text-slate-400">Nothing sent yet. Use Email, WhatsApp, the client link or Download above.</p>
                ) : (
                  <ul className="space-y-2">
                    {selected.shares.map((share, index) => (
                      <li key={`${share.at}-${index}`} className="border-b border-line/60 pb-2 last:border-0 last:pb-0">
                        <div className="text-[11px] font-semibold capitalize text-navy">{share.channel}{share.recipient ? ` · ${share.recipient}` : ''}</div>
                        {share.subject ? <div className="text-[10px] text-slate-500">{share.subject}</div> : null}
                        <div className="mt-0.5 text-[10px] text-slate-400">{share.atLabel}</div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-1.5 rounded-md bg-canvas px-2.5 py-2 text-[10px] text-slate-500">
                  <FileText size={12} className="text-teal-700" />
                  {selected.hasPdf ? `PDF stored for revision ${selected.revision}` : 'PDF not stored yet — download it once to file it'}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                  <ArrowRight size={11} /> Client link: <span className="truncate">{selected.shareUrl}</span>
                </div>
              </Section>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-white px-6 py-16 text-center">
            <Ban size={20} className="mx-auto text-slate-300" />
            <p className="mt-2 text-xs text-slate-500">{loading ? 'Loading…' : 'Select a quotation, or create a new one.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
