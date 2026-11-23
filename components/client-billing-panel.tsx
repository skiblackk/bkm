'use client';

import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Building2, ImagePlus, Loader2, Printer, Receipt, Trash2, Wallet } from 'lucide-react';
import type { Client, ClientReceipt } from '@/lib/types';

type Props = {
  client: Client;
  onSnapshot: (snapshot: unknown, message: string) => void;
};

const money = (currency: string, value: number) =>
  `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isPdf = (url: string) => url.startsWith('data:application/pdf');

/**
 * Billing and identity for one client record.
 *
 * Two things the register could not express before:
 *
 *   1. Not every organisation is a client BKM bills. Some are suppliers BKM
 *      pays — the money runs the other way. That is now a property of the
 *      record, and the money panels follow it.
 *   2. A payment produces a numbered receipt that can be printed. Before this,
 *      there was nowhere to record what BKM agreed to pay and nothing to hand
 *      over once it was paid.
 *
 * Logos are stored as a data URI on the row rather than in a storage bucket:
 * it needs no bucket, no signed URL and no second permission model, and a
 * company logo is a few kilobytes.
 */
export default function ClientBillingPanel({ client, onSnapshot }: Props) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [chargeForm, setChargeForm] = useState({
    serviceName: '',
    description: '',
    direction: client.relationship === 'vendor' ? 'payable' : 'receivable',
    amount: '',
    billingFrequency: 'monthly',
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  const [paymentForm, setPaymentForm] = useState({ chargeId: '', amount: '', method: 'Bank transfer', reference: '', paidOn: new Date().toISOString().slice(0, 10) });
  const [receipt, setReceipt] = useState<ClientReceipt | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  // Follow the relationship when it changes on the record.
  useEffect(() => {
    setChargeForm((current) => ({ ...current, direction: client.relationship === 'vendor' ? 'payable' : 'receivable' }));
  }, [client.relationship, client.id]);

  useEffect(() => { setReceipt(null); setError(''); setNotice(''); }, [client.id]);

  const call = async (body: Record<string, unknown>, fallback: string, key: string) => {
    setBusy(key); setError(''); setNotice('');
    try {
      const response = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? fallback); return null; }
      onSnapshot(payload.snapshot, payload.message ?? '');
      setNotice(payload.message ?? '');
      return payload;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      return null;
    } finally { setBusy(''); }
  };

  const changeRelationship = (relationship: 'serviced' | 'vendor') => void call(
    { action: 'setClientRelationship', clientId: client.id, relationship },
    'Unable to change how this record is classified.',
    'relationship',
  );

  const pickLogo = (file: File) => {
    setError(''); setNotice('');
    if (!/^image\//.test(file.type)) { setError('Choose an image file (PNG, JPG, SVG or WebP).'); return; }
    if (file.size > 200 * 1024) { setError(`That file is ${(file.size / 1024).toFixed(0)} KB. Use an image under 200 KB so the logo stays quick to load.`); return; }
    const reader = new FileReader();
    reader.onload = () => { void call({ action: 'setClientLogo', clientId: client.id, logoUrl: String(reader.result) }, 'Unable to save the logo.', 'logo'); };
    reader.onerror = () => setError('That image could not be read. Try another file.');
    reader.readAsDataURL(file);
  };

  const addCharge = async () => {
    const amount = Number(chargeForm.amount);
    if (!chargeForm.serviceName.trim()) { setError('Describe the service being paid for.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the amount as a number greater than zero.'); return; }
    const done = await call({
      action: 'addServiceCharge',
      clientId: client.id,
      serviceName: chargeForm.serviceName,
      description: chargeForm.description,
      direction: chargeForm.direction,
      amount,
      billingFrequency: chargeForm.billingFrequency,
      effectiveFrom: chargeForm.effectiveFrom,
    }, 'Unable to add the service charge.', 'charge');
    if (done) setChargeForm({ ...chargeForm, serviceName: '', description: '', amount: '' });
  };

  const addPayment = async () => {
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the payment amount as a number greater than zero.'); return; }
    const done = await call({
      action: 'recordClientPayment',
      clientId: client.id,
      chargeId: paymentForm.chargeId || null,
      amount,
      method: paymentForm.method,
      reference: paymentForm.reference,
      paidOn: paymentForm.paidOn,
    }, 'Unable to record the payment.', 'payment');
    if (done) setPaymentForm({ ...paymentForm, amount: '', reference: '' });
  };

  const print = async (paymentId: string) => {
    const payload = await call({ action: 'issueReceipt', paymentId }, 'Unable to issue a receipt.', `receipt-${paymentId}`);
    if (payload?.receipt) setReceipt(payload.receipt as ClientReceipt);
  };

  const vendor = client.relationship === 'vendor';
  const currency = client.serviceCharges[0]?.currency ?? 'KES';
  const committed = client.serviceCharges.filter((charge) => charge.status === 'Active').reduce((total, charge) => total + charge.amount, 0);
  const settled = client.payments.reduce((total, payment) => total + payment.amount, 0);
  const receiptFor = new Map(client.receipts.map((item) => [item.paymentId, item]));

  return <div className="space-y-5">
    {/* Identity + classification */}
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {client.logoUrl
            ? <img src={client.logoUrl} alt={`${client.name} logo`} data-testid="client-logo" style={{ maxHeight: 56, maxWidth: 120, objectFit: 'contain' }} className="rounded-lg border border-line bg-white p-1.5" />
            : <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><Building2 size={22} /></span>}
          <div>
            <div className="eyebrow">Relationship</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <BadgeCheck size={15} className={vendor ? 'text-amber-600' : 'text-teal-700'} />
              <span className="text-sm font-semibold">{vendor ? 'Paid by BKM' : 'Serviced by BKM'}</span>
              <span className="text-xs text-slate-500">{vendor ? 'A supplier BKM pays for services' : 'A client BKM bills for work delivered'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) pickLogo(file); event.currentTarget.value = ''; }} />
          <button type="button" data-testid="add-logo" disabled={!!busy} onClick={() => logoInput.current?.click()} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-navy hover:border-teal-300 disabled:opacity-50">
            {busy === 'logo' ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}{client.logoUrl ? 'Replace logo' : 'Add logo'}
          </button>
          {client.logoUrl && <button type="button" data-testid="remove-logo" disabled={!!busy} onClick={() => void call({ action: 'setClientLogo', clientId: client.id, logoUrl: null }, 'Unable to remove the logo.', 'logo')} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-red-300 disabled:opacity-50"><Trash2 size={12} /> Remove</button>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">This record is</span>
        <button type="button" data-testid="mark-serviced" disabled={!!busy || !vendor} onClick={() => changeRelationship('serviced')} className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${!vendor ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-line bg-white text-slate-600 hover:border-teal-300'}`}>Serviced by BKM</button>
        <button type="button" data-testid="mark-vendor" disabled={!!busy || vendor} onClick={() => changeRelationship('vendor')} className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${vendor ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-line bg-white text-slate-600 hover:border-amber-300'}`}>Paid by BKM</button>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="billing-error">{error}</div>}
      {notice && !error && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800" data-testid="billing-notice">{notice}</div>}
    </div>

    {/* Money */}
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">{vendor ? 'Payable' : 'Receivable'}</div>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em]">Services and amounts</h3>
          <p className="mt-1 text-xs text-slate-500">{vendor ? 'What BKM buys from this organisation, and what BKM pays for it.' : 'What BKM provides to this client, and what is billed for it.'}</p>
        </div>
        <div className="flex gap-4 text-right">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{vendor ? 'Agreed' : 'Billed'}</div><div className="mt-1 text-lg font-semibold tabular" data-testid="committed-total">{money(currency, committed)}</div></div>
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Paid</div><div className="mt-1 text-lg font-semibold tabular text-teal-700" data-testid="settled-total">{money(currency, settled)}</div></div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {client.serviceCharges.map((charge) => <div key={charge.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5" data-testid="charge-row">
          <div className="min-w-0">
            <div className="text-xs font-semibold">{charge.serviceName}</div>
            <div className="text-[11px] text-slate-500">{charge.direction === 'payable' ? 'BKM pays' : 'Client pays'} · {charge.billingFrequency} · from {charge.effectiveFrom || '—'}{charge.description ? ` · ${charge.description}` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tabular">{money(charge.currency, charge.amount)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${charge.status === 'Active' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>{charge.status}</span>
          </div>
        </div>)}
        {!client.serviceCharges.length && <p className="text-xs text-slate-500">{vendor ? 'No payable services recorded yet. Add what BKM pays this organisation for.' : 'No service charges recorded yet.'}</p>}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <div className="grid gap-2 md:grid-cols-2">
          <input data-testid="charge-service" className="field" placeholder={vendor ? 'Service BKM pays for (e.g. Legal retainer)' : 'Service BKM provides (e.g. Annual audit)'} value={chargeForm.serviceName} onChange={(event) => setChargeForm({ ...chargeForm, serviceName: event.target.value })} />
          <input data-testid="charge-amount" className="field" inputMode="decimal" placeholder="Amount (KES)" value={chargeForm.amount} onChange={(event) => setChargeForm({ ...chargeForm, amount: event.target.value })} />
          <select data-testid="charge-direction" className="field" value={chargeForm.direction} onChange={(event) => setChargeForm({ ...chargeForm, direction: event.target.value })}>
            <option value="payable">BKM pays this organisation</option>
            <option value="receivable">This organisation pays BKM</option>
          </select>
          <select data-testid="charge-frequency" className="field" value={chargeForm.billingFrequency} onChange={(event) => setChargeForm({ ...chargeForm, billingFrequency: event.target.value })}>
            <option value="one-off">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
          </select>
          <input className="field md:col-span-2" placeholder="What the service covers (optional)" value={chargeForm.description} onChange={(event) => setChargeForm({ ...chargeForm, description: event.target.value })} />
        </div>
        <button type="button" data-testid="add-charge" disabled={busy === 'charge'} onClick={() => void addCharge()} className="mt-3 flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
          {busy === 'charge' ? <Loader2 size={13} className="animate-spin" /> : <Wallet size={13} />} Add service and amount
        </button>
      </div>
    </div>

    {/* Payments + receipts */}
    <div className="panel p-5">
      <div className="eyebrow">Settlement</div>
      <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em]">Payments and receipts</h3>
      <p className="mt-1 text-xs text-slate-500">Record a payment, then generate its receipt. A receipt number is issued once per payment.</p>

      <div className="mt-4 space-y-2">
        {client.payments.map((payment) => {
          const issued = receiptFor.get(payment.id);
          return <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5" data-testid="payment-row">
            <div className="min-w-0">
              <div className="text-xs font-semibold">{money(payment.currency, payment.amount)} · {payment.method}</div>
              <div className="text-[11px] text-slate-500">{payment.paidOn}{payment.reference ? ` · ref ${payment.reference}` : ''}</div>
            </div>
            {issued
              ? <button type="button" data-testid="view-receipt" onClick={() => setReceipt(issued)} className="flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-[11px] font-semibold text-teal-800"><Receipt size={12} />{issued.receiptNumber}</button>
              : <button type="button" data-testid="generate-receipt" disabled={busy === `receipt-${payment.id}`} onClick={() => void print(payment.id)} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-navy hover:border-teal-300 disabled:opacity-50">
                  {busy === `receipt-${payment.id}` ? <Loader2 size={12} className="animate-spin" /> : <Receipt size={12} />} Generate receipt
                </button>}
          </div>;
        })}
        {!client.payments.length && <p className="text-xs text-slate-500">No payments recorded yet.</p>}
      </div>

      <div className="mt-4 grid gap-2 border-t border-line pt-4 md:grid-cols-2">
        <select data-testid="payment-charge" className="field" value={paymentForm.chargeId} onChange={(event) => setPaymentForm({ ...paymentForm, chargeId: event.target.value })}>
          <option value="">Against any service</option>
          {client.serviceCharges.map((charge) => <option key={charge.id} value={charge.id}>{charge.serviceName} — {money(charge.currency, charge.amount)}</option>)}
        </select>
        <input data-testid="payment-amount" className="field" inputMode="decimal" placeholder="Amount paid" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
        <input className="field" placeholder="Method (e.g. Bank transfer)" value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })} />
        <input className="field" placeholder="Reference (optional)" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} />
      </div>
      <button type="button" data-testid="record-payment" disabled={busy === 'payment'} onClick={() => void addPayment()} className="mt-3 flex items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2.5 text-xs font-bold text-navy hover:border-teal-300 disabled:opacity-50">
        {busy === 'payment' ? <Loader2 size={13} className="animate-spin" /> : <Wallet size={13} />} Record payment
      </button>
    </div>

    {receipt && <div className="panel p-5" data-testid="receipt-card" id="receipt-print">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Receipt</div>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] tabular">{receipt.receiptNumber}</h3>
        </div>
        <div className="flex gap-2">
          <button type="button" data-testid="print-receipt" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-navy hover:border-teal-300"><Printer size={12} /> Print / save PDF</button>
          <button type="button" onClick={() => setReceipt(null)} className="rounded-md border border-line px-2.5 py-1.5 text-[11px] font-semibold text-slate-500">Close</button>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-xs sm:grid-cols-2">
        <div><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Received from / paid to</dt><dd className="mt-1 font-semibold">{client.name}</dd></div>
        <div><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Amount</dt><dd className="mt-1 font-semibold tabular">{money(receipt.currency, receipt.amount)}</dd></div>
        <div><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Date issued</dt><dd className="mt-1 font-semibold">{receipt.issuedOn}</dd></div>
        <div><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Issued by</dt><dd className="mt-1 font-semibold">{receipt.issuedByName || 'BKM Associates'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Description</dt><dd className="mt-1 text-slate-600">{receipt.notes || (vendor ? `Payment by BKM for services supplied by ${client.name}.` : `Payment received from ${client.name}.`)}</dd></div>
      </dl>
      {isPdf(client.logoUrl) && null}
    </div>}
  </div>;
}
