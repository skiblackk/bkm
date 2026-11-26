'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, BellRing, Check, KeyRound, Loader2, RefreshCcw, ShieldCheck, ThumbsDown, X } from 'lucide-react';

/**
 * The permission requests staff have raised, where the administrator already
 * works — inside the command centre rather than on a separate screen the
 * administrator would have to know about.
 *
 * Approving here writes the grant for real. Before, approving flipped the
 * request's status and nothing else, so the staff member stayed blocked while
 * the administrator believed access had been given.
 */

type RequestRow = {
  id: string;
  requestedByName: string;
  requestedByRole: string;
  permission: string;
  permissionLabel: string;
  reason: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  notifiedAdminCount: number;
};

type ConsolePayload = {
  requests: RequestRow[];
  counts: { pending: number; approved: number; rejected: number };
  canDecide: boolean;
};

function stamp(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Just the number waiting, for a badge somewhere else on the screen. */
export function usePendingAccessRequests(intervalMs = 30_000) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const response = await fetch('/api/access-requests', { cache: 'no-store' });
        if (!response.ok) return;
        const body = await response.json();
        if (live) setPending(Number(body.counts?.pending ?? 0));
      } catch { /* leave the last count */ }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    return () => { live = false; clearInterval(timer); };
  }, [intervalMs]);
  return pending;
}

export default function AccessRequestConsole({ compact = false }: { compact?: boolean }) {
  const [payload, setPayload] = useState<ConsolePayload | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/access-requests', { cache: 'no-store' });
      if (!response.ok) return;
      setPayload(await response.json());
    } catch {
      /* the previous list stays on screen */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const decide = async (row: RequestRow, decision: 'Approved' | 'Rejected') => {
    setBusy(row.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decide', id: row.id, decision, note: notes[row.id] ?? '' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(String(result.error ?? 'The decision could not be saved.'));
      setMessage(decision === 'Approved'
        ? (result.granted
            ? `Approved. ${row.permissionLabel} is now granted to ${row.requestedByName}.`
            : `Approved. ${row.requestedByName} has been told.`)
        : `Rejected. ${row.requestedByName} has been told, with your note.`);
      setNotes((current) => ({ ...current, [row.id]: '' }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The decision could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const pending = payload?.requests.filter((row) => row.status === 'Pending') ?? [];
  const decided = payload?.requests.filter((row) => row.status !== 'Pending') ?? [];
  const visible = showDecided ? decided : pending;

  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${pending.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}><KeyRound size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-navy">{pending.length ? `${pending.length} permission request${pending.length === 1 ? '' : 's'} waiting` : 'No permission requests waiting'}</div>
          <div className="text-[10px] text-slate-500">{pending.length ? pending.map((row) => row.requestedByName).slice(0, 3).join(', ') : 'Staff can ask for access from My workspace.'}</div>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-panel">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Access control</div>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Permission requests</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            What staff have asked for. Approving grants the permission immediately and tells the person in their workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[11px] font-bold text-navy hover:border-gold"><RefreshCcw size={12} /> Refresh</button>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${pending.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {pending.length ? `${pending.length} pending` : 'All decided'}
          </span>
        </div>
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border border-line p-1 text-[11px] font-bold">
        <button type="button" onClick={() => setShowDecided(false)} className={`flex-1 rounded-md px-3 py-1.5 ${showDecided ? 'text-slate-500' : 'bg-navy text-white'}`}>Waiting on you ({pending.length})</button>
        <button type="button" onClick={() => setShowDecided(true)} className={`flex-1 rounded-md px-3 py-1.5 ${showDecided ? 'bg-navy text-white' : 'text-slate-500'}`}>Already decided ({decided.length})</button>
      </div>

      {message && <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800"><BadgeCheck size={13} className="mt-0.5 shrink-0" /> <span>{message}</span></div>}
      {error && <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"><X size={13} className="mt-0.5 shrink-0" /> <span>{error}</span></div>}

      <div className="space-y-2">
        {visible.map((row) => (
          <article key={row.id} className="rounded-xl border border-line bg-canvas/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-navy">{row.requestedByName}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{row.requestedByRole}</span>
                  <span className="flex items-center gap-1 rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-bold text-navy"><KeyRound size={10} /> {row.permissionLabel}</span>
                  {row.status !== 'Pending' && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{row.status}</span>}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{row.reason || 'No reason given.'}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                  <span>Asked {stamp(row.createdAt)}</span>
                  <span className="font-mono text-[10px] text-slate-400">{row.permission}</span>
                  {row.notifiedAdminCount > 0 && <span className="flex items-center gap-1 text-emerald-600"><BellRing size={10} /> {row.notifiedAdminCount} admin{row.notifiedAdminCount === 1 ? '' : 's'} notified</span>}
                  {row.status === 'Approved' && <span className="flex items-center gap-1 text-emerald-700"><ShieldCheck size={10} /> Granted</span>}
                  {row.decidedAt && <span>Decided {stamp(row.decidedAt)}{row.decidedByName ? ` by ${row.decidedByName}` : ''}</span>}
                </div>
                {row.decisionNote && <p className="mt-1.5 rounded-md bg-white px-2 py-1 text-[11px] text-slate-500">Note: {row.decisionNote}</p>}
              </div>

              {row.status === 'Pending' && payload?.canDecide && (
                <div className="flex w-full flex-col gap-2 sm:w-64">
                  <input
                    value={notes[row.id] ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                    placeholder="Note back to the requester (optional)"
                    className="h-9 rounded-lg border border-line bg-white px-2 text-[11px] outline-none focus:border-gold"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => void decide(row, 'Approved')}
                      className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      {busy === row.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve &amp; grant
                    </button>
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => void decide(row, 'Rejected')}
                      className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[11px] font-bold text-slate-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                    >
                      <ThumbsDown size={12} /> Decline
                    </button>
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
            <KeyRound size={20} className="mx-auto text-slate-300" />
            <p className="mt-2 text-xs font-semibold text-slate-500">{showDecided ? 'Nothing decided yet.' : 'No requests waiting. The queue is clear.'}</p>
            <p className="mt-1 text-[11px] text-slate-400">Staff raise these from My workspace → Access request centre.</p>
          </div>
        )}
      </div>
    </section>
  );
}
