import type { Metadata } from 'next';
import Link from 'next/link';
import ClientDecision from '@/components/client-decision';
import { getPublicQuotation } from '@/lib/quotation-service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Quotation — BKM Associates',
  robots: { index: false, follow: false },
};

const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}`;

const STATUS_COPY: Record<string, { label: string; tone: string; note: string }> = {
  Draft: { label: 'Draft', tone: 'bg-slate-100 text-slate-600', note: 'This quotation is still being prepared.' },
  Sent: { label: 'Issued', tone: 'bg-amber-50 text-amber-700', note: 'This quotation is awaiting your decision.' },
  Viewed: { label: 'Issued', tone: 'bg-amber-50 text-amber-700', note: 'This quotation is awaiting your decision.' },
  Accepted: { label: 'Accepted', tone: 'bg-emerald-50 text-emerald-700', note: 'Thank you — this quotation has been accepted.' },
  Rejected: { label: 'Declined', tone: 'bg-red-50 text-red-700', note: 'This quotation was declined. Contact us to revisit the scope.' },
  Expired: { label: 'Expired', tone: 'bg-slate-100 text-slate-600', note: 'The validity date has passed. Ask us to reissue it.' },
};

export default async function PublicQuotationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quotation = await getPublicQuotation(token).catch(() => null);

  if (!quotation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-deep">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">BKM Associates</div>
          <h1 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-navy">This link is not valid</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            The quotation may have been withdrawn, or the link was copied incompletely. Ask your engagement partner to resend it.
          </p>
        </div>
      </main>
    );
  }

  const status = STATUS_COPY[quotation.status] ?? STATUS_COPY.Sent;

  return (
    <main className="min-h-screen bg-canvas py-10">
      <div className="mx-auto w-full max-w-3xl px-4">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">BKM Associates</div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.035em] text-navy">Quotation {quotation.number}</h1>
            <p className="mt-1 text-xs text-slate-500">Prepared for {quotation.clientName} · Issued {quotation.issueDate} · Valid until {quotation.validUntil}</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] ${status.tone}`}>{status.label}</span>
        </header>

        <p className="mt-4 text-sm leading-6 text-slate-600">{status.note}</p>

        <section className="mt-6 rounded-xl border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Scope of engagement</div>
            <div className="mt-1 text-sm font-semibold text-navy">{quotation.service}</div>
            {quotation.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{quotation.description}</p> : null}
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <th className="px-5 py-2.5 text-left font-bold">Description</th>
                <th className="px-3 py-2.5 text-right font-bold">Qty</th>
                <th className="px-3 py-2.5 text-right font-bold">Unit price</th>
                <th className="px-5 py-2.5 text-right font-bold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quotation.lines.map((line, index) => (
                <tr key={index}>
                  <td className="px-5 py-3 text-xs font-semibold text-navy">{line.description}</td>
                  <td className="px-3 py-3 text-right text-xs tabular text-slate-600">{line.quantity}</td>
                  <td className="px-3 py-3 text-right text-xs tabular text-slate-600">{money(quotation.currency, line.unitPrice)}</td>
                  <td className="px-5 py-3 text-right text-xs font-semibold tabular text-navy">{money(quotation.currency, line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end border-t border-line px-5 py-4">
            <div className="w-64 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular">{money(quotation.currency, quotation.subtotal)}</span></div>
              {quotation.discountTotal > 0 && (
                <div className="flex justify-between text-slate-500"><span>Discount</span><span className="tabular">({money(quotation.currency, quotation.discountTotal)})</span></div>
              )}
              <div className="flex justify-between text-slate-500">
                <span>{quotation.taxLabel}{quotation.taxRate ? ` (${quotation.taxRate}%)` : ''}</span>
                <span className="tabular">{money(quotation.currency, quotation.taxTotal)}</span>
              </div>
              <div className="mt-2 flex justify-between rounded-md bg-navy px-3 py-2.5 text-sm font-bold text-white">
                <span>Total payable</span><span className="tabular">{money(quotation.currency, quotation.total)}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {quotation.paymentTerms ? (
            <section className="rounded-xl border border-line bg-white p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Payment terms</div>
              <p className="mt-2 text-xs leading-6 text-slate-600">{quotation.paymentTerms}</p>
            </section>
          ) : null}
          {quotation.notes ? (
            <section className="rounded-xl border border-line bg-white p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Notes</div>
              <p className="mt-2 text-xs leading-6 text-slate-600">{quotation.notes}</p>
            </section>
          ) : null}
        </div>

        {quotation.acceptanceInstructions ? (
          <section className="mt-4 rounded-xl border border-gold/30 bg-gold/10 p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy">How to accept</div>
            <p className="mt-2 text-xs leading-6 text-slate-700">{quotation.acceptanceInstructions}</p>
          </section>
        ) : null}

        <ClientDecision token={token} status={quotation.status} clientName={quotation.contactName || quotation.clientName} number={quotation.number} />

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11px] text-slate-400">
          <span>BKM Associates · Audit · Tax · Advisory</span>
          <span>Built by agentsplus.online</span>
        </footer>
      </div>
    </main>
  );
}
