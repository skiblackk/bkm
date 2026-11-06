'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, ChevronRight, ShieldCheck, UserPlus, X } from 'lucide-react';

export type DirectoryUser = {
  id: string; full_name: string; email: string; is_admin: boolean; active: boolean;
  approval_status?: string; created_at?: string;
  roles?: { name?: string } | Array<{ name?: string }> | null;
};

export function roleName(user: DirectoryUser) {
  return (Array.isArray(user.roles) ? user.roles[0]?.name : user.roles?.name) ?? 'Team member';
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function signedUpLabel(value?: string) {
  if (!value) return 'signed up recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'signed up recently';
  return `signed up ${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Shared polling hook for the admin user directory. Silent for non-admins. */
export function useUserDirectory(pollMs = 45000) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);

  const load = async () => {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { if (alive.current) setForbidden(true); return; }
      if (!response.ok) return;
      const payload = await response.json() as { users?: DirectoryUser[] };
      if (alive.current) { setUsers(payload.users ?? []); setForbidden(false); }
    } catch { /* transient network issue — the next poll retries */ }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(), pollMs);
    return () => { alive.current = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  const act = async (userId: string, action: 'approve' | 'reject') => {
    setBusyId(userId);
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId }) });
      const payload = await response.json();
      setNotice(response.ok ? (payload.message as string) : (payload.error as string) ?? 'Unable to update the account.');
      await load();
    } catch {
      setNotice('Unable to reach the server. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const pending = users.filter((user) => user.approval_status === 'pending');
  return { users, pending, forbidden, busyId, notice, setNotice, act, refresh: load };
}

const SEEN_KEY = 'bkm-approval-toast-seen';

function readSeen(): Set<string> {
  try { return new Set(JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function markSeen(id: string) {
  const seen = readSeen();
  seen.add(id);
  try { window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen))); } catch { /* storage full — toasts may repeat */ }
}

type ToastState = { user: DirectoryUser; outcome?: 'approved' | 'declined' };

/**
 * Pop-up notifications for the administrator when people sign up.
 * Each toast carries a one-click approve shortcut. Toasts appear once per
 * sign-up per browser session — including on the next dashboard load if the
 * admin was away when the person signed up.
 */
export function ApprovalToasts() {
  const { pending, forbidden, busyId, act } = useUserDirectory(45000);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const rendered = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (forbidden) return;
    const seen = readSeen();
    const candidates: ToastState[] = [];
    for (const user of pending) {
      if (rendered.current.has(user.id) || seen.has(user.id)) continue;
      rendered.current.add(user.id);
      candidates.push({ user });
    }
    if (candidates.length) {
      setToasts((current) => [...current, ...candidates.filter((item) => !current.some((toast) => toast.user.id === item.user.id))].slice(0, 3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, forbidden]);

  const close = (id: string) => {
    markSeen(id);
    setToasts((current) => current.filter((toast) => toast.user.id !== id));
  };

  const decide = async (toast: ToastState, action: 'approve' | 'reject') => {
    await act(toast.user.id, action);
    setToasts((current) => current.map((item) => item.user.id === toast.user.id ? { ...item, outcome: action === 'approve' ? 'approved' : 'declined' } : item));
    markSeen(toast.user.id);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.user.id !== toast.user.id)), 2600);
  };

  if (forbidden || toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const done = toast.outcome !== undefined;
        return (
          <div key={toast.user.id} className={`pointer-events-auto animate-page-in overflow-hidden rounded-2xl border bg-white shadow-deep ${done ? 'border-emerald-300' : 'border-gold/50'}`}>
            <div className={`flex items-start gap-3 p-4 ${done ? 'bg-emerald-50' : 'bg-gradient-to-r from-gold/15 to-white'}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-emerald-600 text-white' : 'bg-navy text-gold'}`}>
                {done ? <Check size={17} /> : <UserPlus size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${done ? 'text-emerald-700' : 'text-gold'}`}>
                    {done ? (toast.outcome === 'approved' ? 'Access approved' : 'Sign-up declined') : 'New member sign-up'}
                  </div>
                  <button type="button" onClick={() => close(toast.user.id)} aria-label="Dismiss notification" className="text-slate-400 hover:text-navy"><X size={14} /></button>
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-navy">{toast.user.full_name}</div>
                <div className="truncate text-[11px] text-slate-500">{toast.user.email}</div>
                {!done && (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-semibold text-navy">{roleName(toast.user)}</span>
                      <span className="text-[10px] text-slate-400">{signedUpLabel(toast.user.created_at)}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" disabled={busyId === toast.user.id} onClick={() => void decide(toast, 'approve')} className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-[11px] font-bold text-white transition hover:bg-navy/90 disabled:opacity-50">
                        <Check size={13} /> Approve now
                      </button>
                      <button type="button" disabled={busyId === toast.user.id} onClick={() => void decide(toast, 'reject')} className="rounded-lg border border-red-200 px-3 py-2 text-[11px] font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50">
                        Decline
                      </button>
                      <a href="/admin/users" className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-navy">
                        Open <ChevronRight size={12} />
                      </a>
                    </div>
                  </>
                )}
                {done && <div className="mt-1 text-[11px] font-semibold text-emerald-700">{toast.user.full_name} can sign in now.</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Dashboard card listing everyone waiting for approval, with inline
 * approve/decline. Renders nothing for non-administrators, so it is safe to
 * mount on shared pages.
 */
export function PendingSignupsCard({ compact = false }: { compact?: boolean }) {
  const { pending, forbidden, busyId, act, notice, setNotice } = useUserDirectory(45000);
  if (forbidden) return null;

  return (
    <section className={`animate-rise overflow-hidden rounded-2xl border bg-white shadow-panel ${pending.length ? 'border-gold/60' : 'border-line'}`}>
      <div className={`flex flex-wrap items-center gap-3 border-b px-5 py-4 ${pending.length ? 'border-gold/40 bg-gold/10' : 'border-line bg-canvas/60'}`}>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${pending.length ? 'bg-gold text-navy' : 'bg-navy/5 text-navy'}`}>
          {pending.length ? <UserPlus size={17} /> : <ShieldCheck size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-navy">New member sign-ups</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${pending.length ? 'bg-navy text-gold' : 'bg-emerald-50 text-emerald-700'}`}>
              {pending.length ? `${pending.length} awaiting approval` : 'All clear'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
            {pending.length
              ? 'Approve or decline each request here — or grant access automatically after 4 hours.'
              : 'New sign-ups land here so you can grant access with one click.'}
          </p>
        </div>
        <a href="/admin/users" className="flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy transition hover:border-gold hover:bg-gold/10">
          User management <ChevronRight size={13} />
        </a>
      </div>

      {notice && (
        <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-[11px] font-semibold text-emerald-800">
          <CheckCircle2 size={13} /> {notice}
          <button type="button" onClick={() => setNotice('')} className="ml-auto text-emerald-600/60 hover:text-emerald-800"><X size={12} /></button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="divide-y divide-line">
          {pending.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-gold">{initials(user.full_name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-navy">{user.full_name}</div>
                <div className="truncate text-[11px] text-slate-500">{user.email} · {signedUpLabel(user.created_at)}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{roleName(user)}</span>
              {!compact && (
                <button type="button" disabled={busyId === user.id} onClick={() => void act(user.id, 'reject')} className="rounded-lg border border-red-200 px-3 py-2 text-[11px] font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50">
                  Decline
                </button>
              )}
              <button type="button" disabled={busyId === user.id} onClick={() => void act(user.id, 'approve')} className="flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-[11px] font-bold text-white transition hover:bg-navy/90 disabled:opacity-50">
                <Check size={13} /> Approve
              </button>
            </div>
          ))}
        </div>
      )}

      {pending.length === 0 && !compact && (
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={15} /></span>
          <p className="text-[11px] leading-5 text-slate-500">
            No one is waiting right now. Invite teammates from
            <a href="/admin/users" className="mx-1 font-semibold text-navy underline decoration-gold decoration-2 underline-offset-2 hover:text-gold">User management</a>
            or share the sign-up page — every request will appear here and in a pop-up.
          </p>
        </div>
      )}
    </section>
  );
}

/** Compact count chip for navigation surfaces. */
export function PendingBadge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="ml-auto flex min-w-[18px] items-center justify-center rounded-full bg-gold px-1.5 py-0.5 text-[9px] font-bold text-navy">{count > 9 ? '9+' : count}</span>;
}
