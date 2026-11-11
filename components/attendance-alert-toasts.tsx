'use client';

import { AlertTriangle, BellRing, CheckCircle2, Clock3, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Pop-up attendance alerts for the administrator.
 *
 * The 09:30 sweep runs on the server whether or not anyone is signed in, so the
 * pop-up is simply the delivery surface: it polls the existing notification
 * centre endpoint and raises a toast for any attendance notification that
 * appears while the admin is looking.
 *
 * Every id is remembered once seen (localStorage, plus sessionStorage for the
 * current browser session). That keeps the pop-up quiet across reloads while
 * still letting the bell keep the unread badge.
 */

type Notification = {
  id: string;
  category: string;
  priority: 'Low' | 'Normal' | 'High' | 'Urgent' | string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
  linkPath?: string;
};

const SEEN_KEY = 'bkm-attendance-toast-seen';
const MAX_TOASTS = 3;
const POLL_MS = 15_000;

function readSeen(): Set<string> {
  try {
    const stored = window.localStorage.getItem(SEEN_KEY);
    return new Set(stored ? (JSON.parse(stored) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>) {
  try {
    // keep the list bounded so storage never grows without limit
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(ids).slice(-300)));
  } catch {
    /* storage unavailable: the toast still shows, it simply will not persist */
  }
}

const clock = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export default function AttendanceAlertToasts() {
  const [toasts, setToasts] = useState<Notification[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const ready = useRef(false);

  useEffect(() => {
    seen.current = readSeen();
    ready.current = true;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/notifications?unread=true', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = (await response.json()) as { notifications?: Notification[] };
        if (cancelled || !ready.current) return;
        const fresh = (payload.notifications ?? []).filter(
          (item) => item.category === 'Attendance' && !seen.current.has(item.id),
        );
        if (!fresh.length) return;
        // newest first, and never flood the screen
        const ordered = fresh.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        for (const item of ordered) seen.current.add(item.id);
        writeSeen(seen.current);
        setToasts((current) => [...current, ...ordered.filter((item) => !current.some((toast) => toast.id === item.id))].slice(0, MAX_TOASTS));
      } catch {
        /* a failed poll must never disturb the page */
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const dismiss = (id: string) => setToasts((current) => current.filter((toast) => toast.id !== id));

  const openRecord = async (toast: Notification) => {
    dismiss(toast.id);
    // mark read the same way the notification centre does, then deep-link
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId: toast.id, isRead: true }),
    }).catch(() => undefined);
    window.location.assign(toast.linkPath ?? '/admin/people');
  };

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[70] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-3" role="status" aria-live="polite" aria-label="Attendance alerts">
      {toasts.map((toast) => {
        const missing = /not checked in/i.test(toast.title);
        const urgent = toast.priority === 'High' || toast.priority === 'Urgent';
        return (
          <div key={toast.id} className="pointer-events-auto animate-page-in overflow-hidden rounded-2xl border border-gold/50 bg-white shadow-deep">
            <div className="flex items-start gap-3 bg-gradient-to-r from-gold/15 to-white p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${missing ? 'bg-red-600' : 'bg-amber-500'}`}>
                {missing ? <AlertTriangle size={17} /> : <Clock3 size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Attendance alert{urgent ? ' · priority' : ''}</div>
                  <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss attendance alert" className="text-slate-400 hover:text-navy"><X size={14} /></button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-navy">
                  <BellRing size={13} className="shrink-0 text-gold" />{toast.title}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{toast.body}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" onClick={() => void openRecord(toast)} className="rounded-lg bg-navy px-3 py-1.5 text-[10px] font-bold text-white hover:bg-navy/90">
                    View attendance record
                  </button>
                  <button type="button" onClick={() => dismiss(toast.id)} className="rounded-lg border border-line px-3 py-1.5 text-[10px] font-bold text-slate-600 hover:border-gold">
                    Dismiss
                  </button>
                  <span className="ml-auto text-[10px] text-slate-400">{clock(toast.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Small bell button that mirrors the same unread attendance count, so the
 * administrator can re-open recent alerts after dismissing the pop-ups.
 */
export function AttendanceAlertBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = (await response.json()) as { notifications?: Notification[] };
    setItems((payload.notifications ?? []).filter((item) => item.category === 'Attendance').slice(0, 8));
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const openRecord = async (item: Notification) => {
    setBusy(true);
    if (!item.isRead) {
      await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationId: item.id, isRead: true }) }).catch(() => undefined);
    }
    window.location.assign(item.linkPath ?? '/admin/people');
    setBusy(false);
  };

  const unread = items.filter((item) => !item.isRead).length;

  return (
    <div className="relative z-[80]">
      <button type="button" aria-label="Attendance alerts" onClick={() => setOpen((value) => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-navy hover:border-gold">
        <BellRing size={15} />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-navy">{unread}</span>}
      </button>
      {open && <div className="absolute left-0 top-11 z-[95] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white shadow-deep">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div><div className="text-sm font-semibold text-navy">Attendance alerts</div><div className="mt-0.5 text-[10px] text-slate-400">Automated 09:30 monitoring</div></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-navy"><X size={14} /></button>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          {items.map((item) => (
            <button key={item.id} type="button" disabled={busy} onClick={() => void openRecord(item)} className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-slate-50 ${item.isRead ? 'bg-white' : 'bg-gold/5'}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.isRead ? 'bg-slate-200' : 'bg-red-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-navy">{item.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-slate-600">{item.body}</span>
                  <span className="mt-1 block text-[10px] text-slate-400">{clock(item.createdAt)}</span>
                </span>
              </div>
            </button>
          ))}
          {!items.length && <div className="px-4 py-8 text-center"><CheckCircle2 size={18} className="mx-auto text-emerald-400" /><div className="mt-2 text-xs font-semibold text-slate-500">No attendance alerts</div><div className="mt-1 text-[10px] text-slate-400">Everyone due in has checked in.</div></div>}
        </div>
        {busy && <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[10px] text-slate-400"><Loader2 size={12} className="animate-spin" />Opening…</div>}
      </div>}
    </div>
  );
}
