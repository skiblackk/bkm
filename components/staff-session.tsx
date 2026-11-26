'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Clock3, Loader2, LogOut, MoonStar, ShieldCheck } from 'lucide-react';

/**
 * The front door and the back door of the working day.
 *
 * A session is open from the moment someone arrives in the workspace until they
 * check out. Neither door can be skipped: arriving without opening the day would
 * leave the administrator's list wrong, and signing out without closing it would
 * leave the record open all night. This applies to administrators too — the
 * administrator is a staff member for the purpose of a day's work.
 */

type SessionRecord = {
  id: string;
  userId: string;
  userName: string;
  signedInAt: string;
  lastSeenAt: string;
  signedOutAt: string | null;
  signOutKind: string | null;
  signOutNote: string | null;
  online: boolean;
};

type GateState = 'loading' | 'arrive' | 'ready' | 'blocked';

function clockLabel(iso: string | null | undefined) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch('/api/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error ?? 'The server could not complete that.'));
  return body;
}

/** Ask the server for the current session record. */
async function fetchSession(): Promise<SessionRecord | null> {
  const response = await fetch('/api/staff', { cache: 'no-store' });
  if (!response.ok) return null;
  const body = await response.json().catch(() => ({}));
  return (body?.staffSession ?? null) as SessionRecord | null;
}

/**
 * Wraps the workspace. Renders the arrival gate until a session is open, then
 * keeps it alive with a heartbeat, and exposes the check-out action the header
 * needs before it lets anybody sign out.
 */
export function useStaffSession(active: boolean) {
  // Nothing is asked of the server until there is a signed-in session: before
  // that the workspace is still showing the sign-in screen, and a 401 there
  // would be read as "this person's day cannot be opened".
  const [state, setState] = useState<GateState>(active ? 'loading' : 'loading');
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const open = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Opening is idempotent: signing in on a second device reuses the open
      // session instead of creating a parallel one.
      const body = await call('open');
      setRecord(body?.staffSession ?? null);
      setState('ready');
    } catch (cause) {
      // A profile that is not provisioned in the database cannot hold a session.
      // Do not trap the person behind a gate they can never pass: show the
      // reason and let them sign out.
      setError(cause instanceof Error ? cause.message : 'The session could not be opened.');
      setState('blocked');
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchSession().catch(() => null);
    if (next) setRecord(next);
    return next;
  }, []);

  const checkOut = useCallback(async (note: string) => {
    const trimmed = note.trim().slice(0, 300);
    setError(null);
    // The server closes the session *and* the attendance register in one call,
    // so there is exactly one record of the person leaving.
    const body = await call('close', { kind: 'checked_out', note: trimmed || 'Checked out from the workspace' });
    setRecord(body?.staffSession ?? null);
    return body?.staffSession as SessionRecord | null;
  }, []);

  useEffect(() => {
    if (!active) { setState('loading'); setRecord(null); return; }
    let cancelled = false;
    void (async () => {
      const existing = await refresh();
      if (cancelled) return;
      if (existing && !existing.signedOutAt) {
        setState('ready');
        return;
      }
      // No open session. The day is opened by the person, not by the page —
      // otherwise arriving at the workspace would count as checking in and the
      // gate would be decoration.
      setState('arrive');
    })();
    return () => { cancelled = true; };
  }, [active, open, refresh]);

  useEffect(() => {
    if (!active || state !== 'ready') return;
    const tick = () => { void call('ping').catch(() => undefined); };
    heartbeat.current = setInterval(tick, 60_000);
    return () => { if (heartbeat.current) clearInterval(heartbeat.current); };
  }, [active, state]);

  return { state, record, error, open, refresh, checkOut, setState };
}

/** The arrival screen — every role, administrators included. */
export function ArrivalGate({ session, busy, error, onArrive }: {
  session: { name: string; role: string };
  busy: boolean;
  error?: string | null;
  onArrive: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-deep">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-navy">
          <Clock3 size={25} />
        </div>
        <div className="eyebrow mt-5">Start of day</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-navy">Check in before you start work</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Good morning, {session.name}. Checking in opens your session for {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} and shows the team that you are available.
          <span className="mt-2 block font-medium text-navy">You will be asked to check out before you sign out.</span>
        </p>
        {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
        <button
          disabled={busy}
          onClick={onArrive}
          className="mt-7 flex w-full items-center justify-center gap-2 btn-3d rounded-lg bg-navy px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          Check in for today
          <ChevronRight size={16} />
        </button>
        <p className="mt-4 text-[11px] text-slate-400">Your check-in is recorded in the administrator&apos;s attendance view.</p>
      </div>
    </main>
  );
}

/** Shown instead of the workspace if a session cannot be opened at all. */
export function SessionBlocked({ error, onSignOut }: { error: string; onSignOut: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-deep">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600"><ShieldCheck size={25} /></div>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-navy">Your day could not be opened</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{error}</p>
        <p className="mt-3 text-sm leading-6 text-slate-500">Ask an administrator to confirm your profile is active. You can still sign out.</p>
        <button onClick={onSignOut} className="mt-7 flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-3 text-sm font-bold text-navy hover:border-gold">
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </main>
  );
}

/**
 * The back door. Sign-out runs through here so nobody can leave the workspace
 * without closing the day — the administrator included.
 */
export function CheckOutDialog({ open, session, busy, error, onCancel, onConfirm }: {
  open: boolean;
  session: SessionRecord | null;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(true);
  const started = useMemo(() => clockLabel(session?.signedInAt), [session?.signedInAt]);

  useEffect(() => { if (open) { setNote(''); setConfirmSignOut(true); } }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy/50 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-deep">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-navy"><MoonStar size={20} /></div>
          <div>
            <div className="eyebrow">End of day</div>
            <h2 id="checkout-title" className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Check out before you sign out</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              You checked in at {started}. Checking out closes your session for today and records the time in the administrator&apos;s attendance view.
            </p>
          </div>
        </div>

        <label className="mt-5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500" htmlFor="checkout-note">
          What you finished today <span className="font-medium normal-case tracking-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="checkout-note"
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 300))}
          rows={3}
          placeholder="e.g. Closed the Kilifi Salt Works engagement file; two tasks carried to tomorrow."
          className="mt-2 w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
        />

        <label className="mt-4 flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={confirmSignOut} onChange={(event) => setConfirmSignOut(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line" />
          <span>Also sign me out of the workspace now.</span>
        </label>

        {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onCancel} disabled={busy} className="flex-1 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-navy hover:border-gold disabled:opacity-60">
            Stay signed in
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 btn-3d rounded-lg bg-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            Check out{confirmSignOut ? ' & sign out' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
