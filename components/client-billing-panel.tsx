'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Building2, ImagePlus, Loader2, Printer, Receipt, Trash2, Wallet } from 'lucide-react';
import type { Client, ClientReceipt } from '@/lib/types';
import { BKM_BRAND } from '@/lib/brand';

type Props = {
  client: Client;
  onSnapshot: (snapshot: unknown, message: string) => void;
};

const money = (currency: string, value: number) =>
  `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
/**
 * Prepare an uploaded logo without ever refusing it.
 *
 * There used to be a 200 KB ceiling on logos, which pushed the problem onto
 * the user: their client's logo was "too big". Instead the browser redraws the
 * image at a sensible display size and re-encodes it, so a 6 MB photograph
 * becomes a crisp logo of a few tens of kilobytes. Transparency is preserved
 * for PNG; everything else becomes JPEG. If the browser cannot decode the file
 * at all, the original bytes are sent and the user is told what happened.
 */
async function shrinkImage(file: File, maxEdge = 512): Promise<string> {
  const readAsDataUri = () => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(file);
  });

  // SVG has no pixels to resample; ship it as-is.
  if (file.type === 'image/svg+xml') return readAsDataUri();

  const original = await readAsDataUri();
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('undecodable'));
    element.src = original;
  }).catch(() => null);

  if (!image) return original;

  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return original;
  context.drawImage(image, 0, 0, width, height);

  const keepAlpha = file.type === 'image/png';
  const encoded = canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.92);
  // Only take the re-encode if it actually helped.
  return encoded.length < original.length ? encoded : original;
}

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
  // Portals need a DOM target, so nothing renders into <body> until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
    // No size limit: logos are whatever the client sends. Large files are
    // downscaled in the browser before upload so the row stays manageable
    // without ever refusing the user's file.
    setBusy('logo');
    shrinkImage(file)
      .then((dataUri) => call({ action: 'setClientLogo', clientId: client.id, logoUrl: dataUri }, 'Unable to save the logo.', 'logo'))
      .catch(() => { setBusy(''); setError('That image could not be read. Try another file.'); });
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

    {receipt && mounted && createPortal((() => {
      // The receipt is rendered into <body> through a portal, not into the
      // billing panel. That matters for printing: while the receipt lives deep
      // inside the workspace DOM, every element above it still occupies page
      // height even when hidden, so "Print / save PDF" paginates the whole
      // application and you get five pages. As a direct child of <body> it can
      // be isolated with a single rule and prints as exactly one page.
      const linkedPayment = client.payments.find((payment) => payment.id === receipt.paymentId);
      const linkedCharge = linkedPayment?.chargeId ? client.serviceCharges.find((charge) => charge.id === linkedPayment.chargeId) : undefined;
      const description = receipt.notes
        || linkedCharge?.serviceName
        || (vendor ? `Payment by BKM for services supplied by ${client.name}.` : `Payment received from ${client.name}.`);
      return <div id="receipt-print" data-testid="receipt-print-layer">
        <div className="no-print" style={{ maxWidth: 720, margin: '0 auto 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div className="eyebrow">Receipt preview</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" data-testid="print-receipt" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-md bg-navy px-3 py-2 text-[11px] font-bold text-white hover:bg-navy/90"><Printer size={12} /> Print / save PDF</button>
            <button type="button" onClick={() => setReceipt(null)} className="rounded-md border border-line bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-500">Close</button>
          </div>
        </div>

        <article data-testid="receipt-document" className="bg-white" style={{ maxWidth: 720, margin: '0 auto', padding: 32, border: '1px solid #e4e2dd', borderRadius: 8, color: '#0f172a' }}>
          {/* Letterhead */}
          <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, borderBottom: '3px solid #12263a', paddingBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img src={BKM_BRAND.logoDataUri} alt="BKM Associates" style={{ height: 54, width: 'auto', display: 'block' }} />
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: '#12263a' }}>{BKM_BRAND.name}</div>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8f98', marginTop: 3 }}>{BKM_BRAND.tagline}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8a8f98' }}>{vendor ? 'Payment voucher' : 'Official receipt'}</div>
              <div data-testid="receipt-number" style={{ fontSize: 15, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{receipt.receiptNumber}</div>
              <div style={{ fontSize: 11, color: '#5b6672', marginTop: 3 }}>Issued {receipt.issuedOn}</div>
            </div>
          </header>

          {/* Parties */}
          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: '20px 0', borderBottom: '1px solid #e4e2dd' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8f98' }}>{vendor ? 'Paid to' : 'Received from'}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{client.name}</div>
              <div style={{ fontSize: 11, color: '#5b6672', marginTop: 3 }}>{client.industry}</div>
              <div style={{ fontSize: 11, color: '#5b6672' }}>{client.location}</div>
              {client.contactName ? <div style={{ fontSize: 11, color: '#5b6672', marginTop: 4 }}>Attn: {client.contactName}</div> : null}
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8f98' }}>Issued by</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{BKM_BRAND.name}</div>
              {BKM_BRAND.address.slice(1).map((line) => <div key={line} style={{ fontSize: 11, color: '#5b6672', marginTop: 2 }}>{line}</div>)}
              {BKM_BRAND.contact.map((line) => <div key={line} style={{ fontSize: 11, color: '#5b6672' }}>{line}</div>)}
              <div style={{ fontSize: 11, color: '#5b6672', marginTop: 4 }}>Prepared by {receipt.issuedByName || BKM_BRAND.name}</div>
            </div>
          </section>

          {/* The money */}
          <section style={{ padding: '20px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8f98', borderBottom: '1px solid #aeb2b6', paddingBottom: 8 }}>Description</th>
                  <th style={{ textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8f98', borderBottom: '1px solid #aeb2b6', paddingBottom: 8, width: 150 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: '12px 0', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600 }}>{description}</div>
                    <div style={{ fontSize: 11, color: '#5b6672', marginTop: 3 }}>
                      {linkedCharge ? `${linkedCharge.billingFrequency} · ${linkedCharge.direction === 'payable' ? 'payable by BKM' : 'billed by BKM'}` : 'Ad hoc payment'}
                      {linkedPayment?.reference ? ` · ref ${linkedPayment.reference}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#5b6672', marginTop: 2 }}>Paid on {linkedPayment?.paidOn ?? receipt.issuedOn}{linkedPayment?.method ? ` by ${linkedPayment.method.toLowerCase()}` : ''}</div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 0', verticalAlign: 'top', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(receipt.currency, receipt.amount)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ borderTop: '2px solid #12263a', paddingTop: 12, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#12263a' }}>Total {vendor ? 'paid' : 'received'}</td>
                  <td data-testid="receipt-total" className="receipt-amount" style={{ borderTop: '2px solid #12263a', paddingTop: 12, textAlign: 'right', fontSize: 18, fontWeight: 700, color: '#12263a', fontVariantNumeric: 'tabular-nums' }}>{money(receipt.currency, receipt.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Footer */}
          <footer style={{ borderTop: '1px solid #e4e2dd', paddingTop: 14, display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-end' }}>
            <p style={{ margin: 0, fontSize: 9.5, lineHeight: 1.6, color: '#8a8f98', maxWidth: 420 }}>{BKM_BRAND.footerNote}</p>
            <div style={{ textAlign: 'right', fontSize: 9.5, color: '#8a8f98', whiteSpace: 'nowrap' }}>
              <div style={{ borderTop: '1px solid #aeb2b6', paddingTop: 6, minWidth: 140 }}>Authorised signature</div>
            </div>
          </footer>
        </article>
      </div>;
    })(), document.body)}
  </div>;
}
