'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Armchair, Clock3, DoorOpen, Loader2, LogOut, RefreshCcw, Search, ShieldCheck, X,
} from 'lucide-react';

/**
 * What the team is doing, and who is still on duty.
 *
 * Two questions an administrator actually asks through the day — "who is
 * working?" and "what changed?" — used to require opening the audit page and
 * reconstructing both by hand. They are answered here, live, from the audit
 * trail and the session table.
 */

type SessionRow = {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  signedInAt: string;
  lastSeenAt: string;
  signedOutAt: string | null;
  signOutKind: string | null;
  signOutNote: string | null;
  online: boolean;
};

type ActivityRow = {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  actionLabel: string;
  detail: string;
  severity: string;
  createdAt: string;
};

type Payload = {
  activity: ActivityRow[];
  sessions: { sessions: SessionRow[]; summary: { onDuty: number; online: number; signedOutToday: number } } | null;
};

function time(iso: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function day(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function ago(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return day(iso);
}

const SEVERITY_TONE: Record<string, string> = {
  security: 'bg-red-500',
  change: 'bg-gold',
  info: 'bg-emerald-500',
};

export default function StaffActivityBoard({ dense = false }: { dense?: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/staff?scope=team', { cache: 'no-store' });
      if (!response.ok) return;
      setPayload(await response.json());
    } catch {
      /* keep the last list */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const forceCheckOut = async (row: SessionRow) => {
    setBusy(row.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'force-close', userId: row.userId, note: `Closed by administrator at ${time(new Date().toISOString())}` }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(String(result.error ?? 'The session could not be closed.'));
      setMessage(`${row.userName || 'That session'} has been checked out. They have been told.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The session could not be closed.');
    } finally {
      setBusy(null);
    }
  };

  const sessions = payload?.sessions?.sessions ?? [];
  const onDuty = sessions.filter((row) => !row.signedOutAt);
  const activity = payload?.activity ?? [];
  const people = useMemo(() => Array.from(new Set(activity.map((row) => row.actorName))).sort(), [activity]);
  const filtered = activity.filter((row) => {
    if (person !== 'all' && row.actorName !== person) return false;
    if (!query.trim()) return true;
    const haystack = `${row.actorName} ${row.actionLabel} ${row.detail}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="eyebrow">People &amp; attendance</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Who is on duty</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              A session opens when someone checks in and closes only when they check out. Administrators are on the same rule.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{onDuty.length} on duty</span>
            <button type="button" onClick={() => void load()} className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[11px] font-bold text-navy hover:border-gold"><RefreshCcw size={12} /> Refresh</button>
          </div>
        </div>

        {message && <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800"><ShieldCheck size={13} className="mt-0.5 shrink-0" /><span>{message}</span></div>}
        {error && <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"><X size={13} className="mt-0.5 shrink-0" /><span>{error}</span></div>}

        <div className={`grid gap-2 ${dense ? '' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
          {sessions.slice(0, dense ? 6 : 30).map((row) => (
            <div key={row.id} className={`rounded-xl border p-3 ${row.signedOutAt ? 'border-line bg-canvas/40' : row.online ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.signedOutAt ? 'bg-slate-300' : row.online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="truncate text-xs font-bold text-navy">{row.userName || 'Staff member'}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.08em] text-slate-400">{row.userRole || 'Team member'}</div>
                </div>
                {!row.signedOutAt
                  ? <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => void forceCheckOut(row)}
                      title="Close this session"
                      className="flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2 text-[10px] font-bold text-slate-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                    >
                      {busy === row.id ? <Loader2 size={10} className="animate-spin" /> : <LogOut size={10} />} Check out
                    </button>
                  : <span className="flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-400"><DoorOpen size={10} /> {row.signOutKind === 'forced' ? 'closed by admin' : 'out'}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><Clock3 size={10} /> in {time(row.signedInAt)}</span>
                {row.signedOutAt
                  ? <span className="flex items-center gap-1"><DoorOpen size={10} /> out {time(row.signedOutAt)}</span>
                  : <span>{row.online ? 'active now' : `idle since ${time(row.lastSeenAt)}`}</span>}
                {row.signOutNote && <span className="italic text-slate-400">“{row.signOutNote}”</span>}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center sm:col-span-2 xl:col-span-3">
              <Armchair size={20} className="mx-auto text-slate-300" />
              <p className="mt-2 text-xs font-semibold text-slate-500">Nobody has opened a session today.</p>
              <p className="mt-1 text-[11px] text-slate-400">Sessions appear as soon as someone checks in from the workspace.</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Live record</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">What the team is doing</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Every change written to the audit trail, newest first. Staff see their own rows in My workspace, so nothing here is hidden from the person it concerns.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search changes…" className="h-9 w-48 rounded-lg border border-line pl-7 pr-2 text-[11px] outline-none focus:border-gold" />
            </div>
            <select value={person} onChange={(event) => setPerson(event.target.value)} className="h-9 rounded-lg border border-line px-2 text-[11px] outline-none focus:border-gold">
              <option value="all">Everyone</option>
              {people.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>

        <div className={`space-y-1.5 overflow-y-auto pr-1 ${dense ? 'max-h-[320px]' : 'max-h-[520px]'}`}>
          {filtered.slice(0, dense ? 12 : 60).map((row) => (
            <div key={row.id} className="flex gap-3 rounded-lg border border-line bg-canvas/40 px-3 py-2">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_TONE[row.severity] ?? 'bg-slate-300'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] font-bold text-navy">{row.actorName}</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-slate-400">{row.actorRole}</span>
                  <span className="text-[11px] font-semibold capitalize text-slate-700">{row.actionLabel.replace(/_/g, ' ')}</span>
                </div>
                {row.detail && <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{row.detail}</div>}
              </div>
              <span className="shrink-0 text-[10px] text-slate-400" title={row.createdAt}>{ago(row.createdAt)}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
              <Activity size={20} className="mx-auto text-slate-300" />
              <p className="mt-2 text-xs font-semibold text-slate-500">Nothing matches that yet.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
