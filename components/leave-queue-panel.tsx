'use client';

import { useState } from 'react';
import { CalendarDays, Check, Loader2, X } from 'lucide-react';

export type LeaveRequestRow = {
  id: string;
  userId: string;
  requesterName: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  reason: string;
  status: string;
  decidedAt: string | null;
  createdAt: string;
};

export type LeaveQueue = { requests: LeaveRequestRow[]; canDecide: boolean };

const nice = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const days = (from: string, to: string) => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';
  const count = Math.max(1, Math.round((end - start) / 86400000) + 1);
  return `${count} day${count === 1 ? '' : 's'}`;
};

/**
 * The leave queue.
 *
 * Staff could already submit leave from two places, and the rows did reach
 * `leave_requests` — but no administrative screen ever queried them, so a
 * request was invisible the moment it was sent. This panel is that screen: it
 * shows what is waiting, who asked, and lets an authorised person decide.
 */
export default function LeaveQueuePanel({ queue, busy, onDecide }: { queue: LeaveQueue; busy: boolean; onDecide: (id: string, decision: 'Approved' | 'Rejected', note: string) => Promise<void> }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);
  const pending = queue.requests.filter((request) => request.status === 'Pending');
  const decided = queue.requests.filter((request) => request.status !== 'Pending').slice(0, 12);

  return <section className="rounded-2xl border border-line bg-white p-4 shadow-panel" data-testid="leave-queue">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">People operations</div>
        <h3 className="mt-1 flex items-center gap-2 text-base font-semibold tracking-[-0.02em] text-navy"><CalendarDays size={16} className="text-gold" /> Leave requests</h3>
        <p className="mt-1 text-[11px] text-slate-500">Submitted by staff from My workspace or the request form. Decisions notify the person who asked.</p>
      </div>
      <span data-testid="leave-pending-count" className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${pending.length ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{pending.length} pending</span>
    </div>

    <div className="mt-4 space-y-2">
      {pending.map((request) => <article key={request.id} className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3" data-testid="leave-row">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-bold text-navy">{request.requesterName}</div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              <span className="font-semibold capitalize">{request.leaveType}</span> leave · {nice(request.startsOn)} → {nice(request.endsOn)} · {days(request.startsOn, request.endsOn)}
            </div>
            {request.reason && <div className="mt-1 text-[11px] italic text-slate-500">“{request.reason}”</div>}
            <div className="mt-1 text-[10px] text-slate-400">Submitted {nice(request.createdAt)}</div>
          </div>
          {queue.canDecide ? <div className="flex flex-wrap items-center gap-1.5">
            <input value={notes[request.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Note (optional)" className="h-8 w-36 rounded-md border border-line bg-white px-2 text-[11px] outline-none focus:border-teal-400" />
            <button type="button" data-testid="approve-leave" disabled={busy} onClick={() => void onDecide(request.id, 'Approved', notes[request.id] ?? '')} className="flex items-center gap-1 rounded-md bg-navy px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-navy/90 disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve</button>
            <button type="button" data-testid="reject-leave" disabled={busy} onClick={() => void onDecide(request.id, 'Rejected', notes[request.id] ?? '')} className="flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-red-700 hover:border-red-400 disabled:opacity-50"><X size={12} /> Reject</button>
          </div> : <span className="text-[10px] font-semibold text-slate-500">View only — you cannot decide leave</span>}
        </div>
      </article>)}
      {!pending.length && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-slate-500" data-testid="leave-empty">No leave requests are waiting for a decision.</p>}
    </div>

    {decided.length > 0 && <div className="mt-4 border-t border-line pt-3">
      <button type="button" onClick={() => setShowHistory((current) => !current)} className="text-[11px] font-semibold text-slate-500 hover:text-navy">{showHistory ? 'Hide' : 'Show'} recent decisions ({decided.length})</button>
      {showHistory && <div className="mt-2 space-y-1.5">{decided.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[11px]">
        <span className="font-semibold text-navy">{request.requesterName}</span>
        <span className="text-slate-500 capitalize">{request.leaveType} · {nice(request.startsOn)} → {nice(request.endsOn)}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${request.status === 'Approved' ? 'bg-teal-50 text-teal-700' : request.status === 'Rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{request.status}</span>
      </div>)}</div>}
    </div>}
  </section>;
}
