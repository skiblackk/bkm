'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, CheckCircle2, ClipboardList, History, KeyRound, Loader2, LogOut, MessageCircle,
  Plus, Send, ShieldCheck, Smartphone, X,
} from 'lucide-react';
import { PERMISSION_CATALOGUE } from '@/lib/permission-catalogue';

interface LeaveRow { id: string; leave_type: string; starts_on: string; ends_on: string; reason: string; status: string; decision_note: string | null }
interface AccessRow { id: string; request_type: string; resource_type: string; reason: string; status: string; decision_note: string | null; created_at?: string; decided_by_name?: string | null }
interface FeedRow { id: string; action: string; actionLabel?: string; actorName?: string; detail: string; createdAt: string; severity?: string }
interface Profile { name: string; email: string; phone: string; whatsappOptIn: boolean }
interface SessionRow { signedInAt: string; online: boolean; userName: string }

const CHECKOUT_KEY = 'bkm-checkout-done';

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * "My workspace" — the staff member's own side of the record.
 *
 * Everything an administrator can see about a person's actions is gathered
 * here as well, from the same audit rows, so the visibility runs in both
 * directions: the record is not something kept about you, it is something you
 * can read too.
 */
export default function EmployeeSelfService() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRow[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRow[]>([]);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [staffSession, setStaffSession] = useState<SessionRow | null>(null);

  const [leaveType, setLeaveType] = useState('annual');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');
  const [permission, setPermission] = useState('');
  const [accessReason, setAccessReason] = useState('');
  const [phone, setPhone] = useState('');
  const [optIn, setOptIn] = useState(true);

  const [heldKeys, setHeldKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/self-service', { cache: 'no-store' });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error ?? 'Unable to load your workspace.');
    setLeaveRequests(payload.leaveRequests ?? []);
    setAccessRequests(payload.accessRequests ?? []);
    setFeed(payload.activity ?? []);
    setProfile(payload.profile ?? null);
    setHeldKeys(payload.myPermissions ?? []);
    setStaffSession(payload.staffSession ?? null);
    setPhone(payload.profile?.phone ?? '');
    setOptIn(payload.profile?.whatsappOptIn !== false);
  }, []);

  useEffect(() => { void load().catch(() => setError('Your self-service data could not be loaded.')); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/self-service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Action failed.');
      await load();
      return payload as Record<string, unknown>;
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed.'); return null; }
    finally { setBusy(false); }
  };

  // Only the keys the person does not already hold are worth asking for: the
  // options are narrowed by the grants the server evaluates for this account.
  const myKeys = useMemo(() => new Set(heldKeys), [heldKeys]);
  const pendingKey = useMemo(() => accessRequests.find((row) => row.status === 'Pending')?.reason ?? '', [accessRequests]);

  return (
    <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><CalendarDays size={13} /> My leave</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">Leave requests</h3>
        <div className="mt-3 flex flex-col gap-2">
          <select className="h-9 rounded-lg border border-line px-2 text-xs" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="annual">Annual leave</option><option value="sick">Sick leave</option><option value="personal">Personal leave</option><option value="unpaid">Unpaid leave</option>
          </select>
          <div className="flex gap-2">
            <input type="date" className="h-9 flex-1 rounded-lg border border-line px-2 text-xs" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            <input type="date" className="h-9 flex-1 rounded-lg border border-line px-2 text-xs" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
          <textarea className="min-h-16 rounded-lg border border-line px-2 py-1.5 text-xs" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            disabled={busy || !startsOn || !endsOn}
            onClick={() => { void act({ action: 'request-leave', leaveType, startsOn, endsOn, reason }).then((payload) => { if (payload) { setMessage(`Leave request sent${Number(payload.notified ?? 0) > 0 ? ` — ${payload.notified} administrator${Number(payload.notified) === 1 ? '' : 's'} notified` : ''}.`); setReason(''); } }); }}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"
          >
            <Send size={12} /> Request leave
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {leaveRequests.slice(0, 5).map((row) => (
            <div key={row.id} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">{row.leave_type} · {row.starts_on?.slice(0, 10)} → {row.ends_on?.slice(0, 10)}</span>
                <span className={`font-bold ${row.status === 'Approved' ? 'text-emerald-700' : row.status === 'Rejected' ? 'text-red-700' : row.status === 'Cancelled' ? 'text-slate-400' : 'text-amber-700'}`}>{row.status}</span>
              </div>
              {row.decision_note && <div className="mt-0.5 text-slate-500">{row.decision_note}</div>}
            </div>
          ))}
          {leaveRequests.length === 0 && <div className="text-[11px] text-slate-400">No leave requests yet.</div>}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><KeyRound size={13} /> Access request centre</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">Need more access?</h3>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          Pick what you need. The request goes straight to the administrators as a notification — the moment they open the workspace it is waiting for them.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <select className="h-9 rounded-lg border border-line px-2 text-xs" value={permission} onChange={(e) => setPermission(e.target.value)}>
            <option value="">Choose the permission you need…</option>
            {PERMISSION_CATALOGUE.filter((entry) => !myKeys.has(entry.key)).map((entry) => (
              <option key={entry.key} value={entry.key}>{entry.description} — {entry.key}</option>
            ))}
          </select>
          <textarea className="min-h-16 rounded-lg border border-line px-2 py-1.5 text-xs" placeholder="Why do you need it? This is what the administrator reads first." value={accessReason} onChange={(e) => setAccessReason(e.target.value)} />
          <button
            type="button"
            disabled={busy || !permission || !accessReason}
            onClick={() => {
              void act({ action: 'request-access', permission, reason: accessReason }).then((payload) => {
                if (!payload) return;
                const notified = Number(payload.notified ?? 0);
                setMessage(notified > 0
                  ? `Request sent — ${notified} administrator${notified === 1 ? '' : 's'} notified. You will see the decision here.`
                  : 'Request recorded. No administrator notification went out, so mention it to them directly.');
                setPermission(''); setAccessReason('');
              });
            }}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"
          >
            <Plus size={12} /> Send request
          </button>
          {pendingKey && <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800">Awaiting a decision: {pendingKey.replace(/_/g, ' ')}</div>}
        </div>
        <div className="mt-3 space-y-1.5">
          {accessRequests.slice(0, 6).map((row) => {
            const label = String((row as unknown as { payload?: { permission?: string } }).payload?.permission ?? row.reason ?? '');
            return (
              <div key={row.id} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">{row.request_type.replace(/_/g, ' ')}{label ? ` · ${label.replace(/_/g, ' ')}` : ''}</span>
                  <span className={`font-bold ${row.status === 'Approved' ? 'text-emerald-700' : row.status === 'Rejected' ? 'text-red-700' : 'text-amber-700'}`}>{row.status}</span>
                </div>
                <div className="mt-0.5 text-slate-500">{row.reason}</div>
                {(row.decided_by_name || row.decision_note) && <div className="mt-0.5 text-[10px] text-slate-400">{row.decided_by_name ? `Decided by ${row.decided_by_name}` : 'Decided'}{row.decision_note ? ` — ${row.decision_note}` : ''}</div>}
              </div>
            );
          })}
          {accessRequests.length === 0 && <div className="text-[11px] text-slate-400">No access requests yet.</div>}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><Smartphone size={13} /> WhatsApp contact</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">The number you use on WhatsApp</h3>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          When an administrator broadcasts and you are not in the system, the message can reach you on WhatsApp — but only if this number is the one you actually use on WhatsApp.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <input
            className="h-9 rounded-lg border border-line px-2 text-xs"
            placeholder="0722 123 456"
            value={phone}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
          <label className="flex items-start gap-2 text-[11px] text-slate-600">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
            <span>I am happy to receive workspace broadcasts on this number.</span>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => { void act({ action: 'save-phone', phone, whatsappOptIn: optIn }).then((payload) => { if (payload) { setMessage(payload.phone ? `Saved — broadcasts will reach +${payload.phone}.` : 'Number removed.'); setPhone(String(payload.phone ?? '')); } }); }}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"
          >
            <CheckCircle2 size={12} /> Save number
          </button>
          {profile?.phone
            ? <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-800"><MessageCircle size={11} /> On file: +{profile.phone}{profile.whatsappOptIn ? '' : ' (broadcasts declined)'}</div>
            : <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800">No number on file yet — you would be skipped in a WhatsApp broadcast.</div>}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-panel xl:col-span-2">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><History size={13} /> My activity</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">What you have done today</h3>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">Every action you take in the workspace is written to the audit trail. This is the same record the administrator sees.</p>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {feed.slice(0, 12).map((row) => (
            <div key={row.id} className="flex gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
              <ClipboardList size={12} className="mt-0.5 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <div className="font-semibold capitalize text-slate-700">{(row.actionLabel ?? row.action).replace(/_/g, ' ')}</div>
                {row.detail && <div className="text-slate-500">{row.detail}</div>}
                <div className="text-[10px] text-slate-400">{when(row.createdAt)}</div>
              </div>
            </div>
          ))}
          {feed.length === 0 && <div className="text-[11px] text-slate-400">Your actions will appear here as you work.</div>}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><ShieldCheck size={13} /> Today&apos;s session</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">Check out when you finish</h3>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          Your session keeps running until you check out, and the sign-out button will ask you to check out first. Administrators are held to the same rule.
        </p>
        {staffSession
          ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-900">
              <div className="font-bold">Checked in at {when(staffSession.signedInAt)}</div>
              <div className="mt-0.5 text-[10px] text-emerald-700">Session open{staffSession.online ? ' · you are shown as online' : ' · heartbeat paused'}</div>
            </div>
          : <div className="mt-3 rounded-lg border border-line px-2.5 py-2 text-[11px] text-slate-500">No session is open right now.</div>}
        <button
          type="button"
          disabled={busy || !staffSession}
          onClick={() => {
            void act({ action: 'check-out', note: 'Checked out from My workspace' }).then((payload) => {
              if (!payload) return;
              localStorage.setItem(CHECKOUT_KEY, new Date().toISOString());
              setMessage('Checked out for the day. You can now sign out.');
            });
          }}
          className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-[11px] font-bold text-navy hover:border-gold disabled:opacity-40"
        >
          <LogOut size={12} /> Check out for today
        </button>
      </div>

      {(busy || message || error) && (
        <div className="lg:col-span-2 xl:col-span-3">
          {busy && <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500"><Loader2 size={12} className="animate-spin" /> Saving…</div>}
          {message && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800"><CheckCircle2 size={12} /> {message}</div>}
          {error && <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={12} /></button></div>}
        </div>
      )}
    </section>
  );
}
