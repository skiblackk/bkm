'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, ClipboardList, History, KeyRound, Loader2, Plus, Send, X } from 'lucide-react';

interface LeaveRow { id: string; leave_type: string; starts_on: string; ends_on: string; reason: string; status: string; decision_note: string | null }
interface AccessRow { id: string; request_type: string; resource_type: string; reason: string; status: string; decision_note: string | null }
interface ActivityRow { id: string; event_type: string; description: string; created_at: string }

export default function EmployeeSelfService() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRow[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [leaveType, setLeaveType] = useState('annual');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');
  const [permission, setPermission] = useState('');
  const [accessReason, setAccessReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/self-service', { cache: 'no-store' });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error ?? 'Unable to load your workspace.');
    setLeaveRequests(payload.leaveRequests ?? []);
    setAccessRequests(payload.accessRequests ?? []);
    setActivity(payload.activity ?? []);
  }, []);

  useEffect(() => { void load().catch(() => setError('Your self-service data could not be loaded.')); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/self-service', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Action failed.');
      setMessage('Saved.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="grid gap-5 lg:grid-cols-3">
      <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><CalendarDays size={13} /> My leave</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">Leave requests</h3>
        <div className="mt-3 flex flex-col gap-2">
          <select className="h-9 rounded-lg border border-line px-2 text-xs" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            <option value="annual">Annual leave</option><option value="sick">Sick leave</option><option value="personal">Personal leave</option><option value="unpaid">Unpaid leave</option>
          </select>
          <div className="flex gap-2"><input type="date" className="h-9 flex-1 rounded-lg border border-line px-2 text-xs" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /><input type="date" className="h-9 flex-1 rounded-lg border border-line px-2 text-xs" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></div>
          <textarea className="min-h-16 rounded-lg border border-line px-2 py-1.5 text-xs" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" disabled={busy || !startsOn || !endsOn} onClick={() => { void act({ action: 'request-leave', leaveType, startsOn, endsOn, reason }); setReason(''); }} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"><Send size={12} /> Request leave</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {leaveRequests.slice(0, 5).map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-700">{r.leave_type} · {r.starts_on?.slice(0, 10)} → {r.ends_on?.slice(0, 10)}</span><span className={`font-bold ${r.status === 'Approved' ? 'text-emerald-700' : r.status === 'Rejected' ? 'text-red-700' : r.status === 'Cancelled' ? 'text-slate-400' : 'text-amber-700'}`}>{r.status}</span></div>
              {r.decision_note && <div className="mt-0.5 text-slate-500">{r.decision_note}</div>}
            </div>
          ))}
          {leaveRequests.length === 0 && <div className="text-[11px] text-slate-400">No leave requests yet.</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><KeyRound size={13} /> Access request centre</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">Need more access?</h3>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">Ask for a specific permission — it goes to your manager or an administrator for a decision.</p>
        <div className="mt-3 flex flex-col gap-2">
          <input className="h-9 rounded-lg border border-line px-2 text-xs" placeholder="Permission key (e.g. view_finance)" value={permission} onChange={(e) => setPermission(e.target.value)} />
          <textarea className="min-h-16 rounded-lg border border-line px-2 py-1.5 text-xs" placeholder="Why do you need it?" value={accessReason} onChange={(e) => setAccessReason(e.target.value)} />
          <button type="button" disabled={busy || !permission || !accessReason} onClick={() => { void act({ action: 'request-access', permission, reason: accessReason }); setPermission(''); setAccessReason(''); }} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 text-[11px] font-bold text-white disabled:opacity-40"><Plus size={12} /> Send request</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {accessRequests.slice(0, 5).map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-700">{r.request_type.replace(/_/g, ' ')} · {r.resource_type}</span><span className={`font-bold ${r.status === 'Approved' ? 'text-emerald-700' : r.status === 'Rejected' ? 'text-red-700' : 'text-amber-700'}`}>{r.status}</span></div>
              <div className="mt-0.5 text-slate-500">{r.reason}</div>
            </div>
          ))}
          {accessRequests.length === 0 && <div className="text-[11px] text-slate-400">No access requests yet.</div>}
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><History size={13} /> My activity</div>
        <h3 className="mt-1 text-base font-semibold tracking-[-0.02em] text-navy">Personal activity history</h3>
        <div className="mt-3 space-y-1.5">
          {activity.slice(0, 8).map((row) => (
            <div key={row.id} className="flex gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
              <ClipboardList size={12} className="mt-0.5 shrink-0 text-slate-400" />
              <div><div className="font-semibold text-slate-700">{row.event_type || 'activity'}</div><div className="text-slate-500">{row.description}</div><div className="text-[10px] text-slate-400">{new Date(row.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>
            </div>
          ))}
          {activity.length === 0 && <div className="text-[11px] text-slate-400">Your actions will appear here.</div>}
        </div>
        {busy && <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-500"><Loader2 size={12} className="animate-spin" /> Saving…</div>}
        {message && <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800"><CheckCircle2 size={12} /> {message}</div>}
        {error && <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"><span>{error}</span><button type="button" onClick={() => setError('')}><X size={12} /></button></div>}
      </div>
    </section>
  );
}
