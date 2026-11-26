'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Check, KeyRound, Loader2, ThumbsDown, X } from 'lucide-react';

/**
 * The pop-up an administrator sees the moment a permission request is raised.
 *
 * The request used to be written to the database and then sit there: no bell,
 * no toast, no count on the dashboard. Polling is deliberately short (20s) so
 * "the moment" means "within the time it takes to finish a sentence", and the
 * decision buttons live in the toast itself — an administrator can grant
 * without navigating anywhere.
 */

type Pending = {
  id: string;
  requestedByName: string;
  requestedByRole: string;
  permission: string;
  permissionLabel: string;
  reason: string;
  createdAt: string;
};

const SEEN_KEY = 'bkm-access-toasts-seen';

function loadSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-200)));
  } catch { /* storage disabled */ }
}

export default function AccessRequestToasts() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const seen = useRef<Set<string>>(loadSeen());
  const hydrated = useRef(false);

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/access-requests', { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json();
      const pending: Pending[] = body.requests ?? [];
      const fresh = pending.filter((row) => !seen.current.has(row.id));
      if (!hydrated.current) {
        // On first load show only what is genuinely waiting, once per browser:
        // a toast that reappears on every screen change is a nuisance, not a
        // notification. Anything new after this arrives through the branch below.
        hydrated.current = true;
        const unseen = pending.filter((row) => !seen.current.has(row.id));
        if (unseen.length) {
          setQueue((current) => {
            const ids = new Set(current.map((row) => row.id));
            return [...unseen.filter((row) => !ids.has(row.id)), ...current].slice(0, 4);
          });
        }
        return;
      }
      if (fresh.length) setQueue((current) => [...fresh, ...current].slice(0, 4));
    } catch { /* polling is best-effort */ }
  }, []);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => { void poll(); }, 20_000);
    return () => clearInterval(timer);
  }, [poll]);

  const dismiss = (id: string) => {
    seen.current.add(id);
    saveSeen(seen.current);
    setQueue((current) => current.filter((row) => row.id !== id));
  };

  const decide = async (row: Pending, decision: 'Approved' | 'Rejected') => {
    setBusy(row.id);
    try {
      const response = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decide', id: row.id, decision, note: decision === 'Approved' ? 'Approved from the notification.' : 'Declined from the notification.' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body.error ?? 'The decision could not be saved.'));
      setNotice(decision === 'Approved'
        ? (body.granted ? `${row.permissionLabel} granted to ${row.requestedByName}.` : `Approved — ${row.requestedByName} has been told.`)
        : `Declined — ${row.requestedByName} has been told.`);
      dismiss(row.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The decision could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!queue.length && !notice) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
      {notice && (
        <div className="pointer-events-auto flex items-start gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[11px] font-semibold text-emerald-800 shadow-deep">
          <Check size={13} className="mt-0.5 shrink-0" /><span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')}><X size={12} /></button>
        </div>
      )}
      {queue.map((row) => (
        <article key={row.id} className="pointer-events-auto rounded-xl border border-gold/50 bg-white p-3 shadow-deep">
          <div className="flex items-start gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/20 text-navy"><BellRing size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-600">Permission request</div>
              <div className="mt-0.5 text-xs font-bold leading-4 text-navy">{row.requestedByName} wants {row.permissionLabel}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-400">{row.requestedByRole}</div>
              {row.reason && <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-slate-600">{row.reason}</p>}
            </div>
            <button type="button" onClick={() => dismiss(row.id)} className="text-slate-400 hover:text-navy" aria-label="Dismiss"><X size={13} /></button>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={busy === row.id}
              onClick={() => void decide(row, 'Approved')}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-navy px-2 text-[10px] font-bold text-white disabled:opacity-50"
            >
              {busy === row.id ? <Loader2 size={10} className="animate-spin" /> : <KeyRound size={10} />} Grant
            </button>
            <button
              type="button"
              disabled={busy === row.id}
              onClick={() => void decide(row, 'Rejected')}
              className="flex h-7 items-center justify-center gap-1 rounded-md border border-line px-2 text-[10px] font-bold text-slate-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
            >
              <ThumbsDown size={10} /> Decline
            </button>
            <a href="/admin?tab=access" className="flex h-7 items-center rounded-md border border-line px-2 text-[10px] font-bold text-navy hover:border-gold">Open</a>
          </div>
        </article>
      ))}
    </div>
  );
}
