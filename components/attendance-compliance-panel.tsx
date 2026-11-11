'use client';

import { AlertTriangle, CalendarClock, Check, Clock3, Info, Loader2, RefreshCw, UserCheck, UserMinus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Row = {
  staffId: string; name: string; role: string;
  status: 'On time' | 'Late' | 'Not checked in by 9:30 AM' | 'On approved leave' | 'Not scheduled';
  checkIn: string | null; checkOut: string | null; reportingDeadline: string; note: string | null; recordId: string | null; alerted: boolean;
};
type Summary = {
  date: string; reportingDeadline: string; expected: number; onTime: number; late: number;
  notCheckedIn: number; onLeave: number; notScheduled: number; compliancePercentage: number; deadlinePassed: boolean; alertsSent: number; rows: Row[];
};
type AlertLog = { id: string; kind: 'missing_check_in' | 'late_arrival'; staffId: string | null; date: string; status: 'created' | 'skipped' | 'failed'; reason: string | null; createdAt: string };

const tone = (status: Row['status']) =>
  status === 'On time' ? 'bg-emerald-50 text-emerald-700'
  : status === 'Late' ? 'bg-amber-50 text-amber-700'
  : status === 'Not checked in by 9:30 AM' ? 'bg-red-50 text-red-700'
  : 'bg-slate-100 text-slate-600';

const when = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };

function Metric({ label, value, detail, Icon, accent }: { label: string; value: string | number; detail: string; Icon: typeof UserCheck; accent: string }) {
  return <div className="rounded-2xl border border-line bg-white p-4 shadow-panel"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}><Icon size={16} /></div><div className="mt-3 text-2xl font-semibold tracking-[-0.04em] tabular text-navy">{value}</div><div className="mt-1 text-xs font-bold text-slate-700">{label}</div><div className="mt-1 text-[10px] text-slate-400">{detail}</div></div>;
}

export default function AttendanceCompliancePanel({ summary, alerts, onSweep, busy }: { summary: Summary; alerts: AlertLog[]; onSweep: () => Promise<void>; busy: boolean }) {
  const [focus, setFocus] = useState<'all' | Row['status']>('all');
  // Honour ?staff= from a notification deep link, so "view the record" lands on the person.
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    const staff = new URLSearchParams(window.location.search).get('staff');
    if (staff) { setHighlight(staff); setFocus('all'); }
  }, []);

  const rows = useMemo(() => {
    const filtered = focus === 'all' ? summary.rows : summary.rows.filter((row) => row.status === focus);
    return highlight ? [...filtered].sort((a, b) => (a.staffId === highlight ? -1 : b.staffId === highlight ? 1 : 0)) : filtered;
  }, [summary.rows, focus, highlight]);

  const filters: Array<{ id: 'all' | Row['status']; label: string; count: number }> = [
    { id: 'all', label: 'Everyone', count: summary.rows.length },
    { id: 'On time', label: 'On time', count: summary.onTime },
    { id: 'Late', label: 'Late', count: summary.late },
    { id: 'Not checked in by 9:30 AM', label: 'Not checked in', count: summary.notCheckedIn },
    { id: 'On approved leave', label: 'Approved leave', count: summary.onLeave },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Metric label="Checked in on time" value={summary.onTime} detail={`Deadline ${summary.reportingDeadline} EAT`} Icon={UserCheck} accent="bg-emerald-600 text-white" />
        <Metric label="Late arrivals" value={summary.late} detail="Checked in after the deadline" Icon={Clock3} accent="bg-amber-500 text-white" />
        <Metric label="Not checked in by 9:30 AM" value={summary.notCheckedIn} detail="Expected but unseen" Icon={AlertTriangle} accent="bg-red-600 text-white" />
        <Metric label="On approved leave" value={summary.onLeave} detail="Excluded from alerts" Icon={UserMinus} accent="bg-slate-500 text-white" />
        <Metric label="Attendance compliance" value={summary.deadlinePassed || !summary.expected ? `${summary.compliancePercentage}%` : 'In progress'} detail={!summary.expected ? 'Nobody was due in today' : summary.deadlinePassed ? `${summary.onTime + summary.late} of ${summary.expected} due in by ${summary.reportingDeadline}` : `Deadline ${summary.reportingDeadline} EAT has not passed yet`} Icon={CalendarClock} accent="bg-teal-600 text-white" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-panel">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="eyebrow">Automated monitoring · Africa/Nairobi</div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Daily attendance register</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              The 9:30 AM check runs on the server and alerts you whether or not this dashboard is open. Status is
              &ldquo;Not checked in by 9:30 AM&rdquo; — nobody is marked absent automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">{summary.alertsSent} alert{summary.alertsSent === 1 ? '' : 's'} sent today</span>
            {!summary.deadlinePassed && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">Before {summary.reportingDeadline} — day in progress</span>}
            <button type="button" disabled={busy} onClick={() => void onSweep()} className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy transition hover:border-gold disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Run 9:30 check now
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          {filters.map((filter) => (
            <button key={filter.id} type="button" onClick={() => { setFocus(filter.id); setHighlight(null); }}
              className={`rounded-full px-3 py-1.5 text-[10px] font-bold transition ${focus === filter.id ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {filter.label} <span className="opacity-70">{filter.count}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-slate-400">
              <tr><th className="px-5 py-3">Employee</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Check-in</th><th className="px-3 py-3">Check-out</th><th className="px-3 py-3">Note</th><th className="px-3 py-3 text-right">Alert</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.staffId} className={row.staffId === highlight ? 'bg-gold/10' : undefined}>
                  <td className="px-5 py-3"><div className="text-xs font-semibold text-navy">{row.name}</div><div className="mt-0.5 text-[10px] text-slate-400">{row.role}</div></td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone(row.status)}`}>{row.status}</span></td>
                  <td className="px-3 py-3 text-xs tabular text-slate-600">{row.checkIn ?? '—'}</td>
                  <td className="px-3 py-3 text-xs tabular text-slate-600">{row.checkOut ?? '—'}</td>
                  <td className="px-3 py-3 text-[10px] leading-4 text-slate-500">{row.note ?? '—'}</td>
                  <td className="px-3 py-3 text-right">
                    {row.alerted ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check size={11} /> Sent</span>
                      : row.status === 'Not checked in by 9:30 AM' || row.status === 'Late' ? <span className="text-[10px] text-slate-400">Pending</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-slate-400">Nobody in this category today.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-panel">
        <div className="border-b border-line px-5 py-4">
          <div className="eyebrow">Notification history</div>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-navy">Attendance alert log</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Every attempt is recorded, including why a check was skipped — leave, holiday, schedule or a duplicate.</p>
        </div>
        <div className="max-h-[340px] divide-y divide-line overflow-y-auto">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${alert.status === 'created' ? 'bg-emerald-50 text-emerald-700' : alert.status === 'skipped' ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-700'}`}>{alert.status}</span>
              <span className="text-xs font-semibold text-navy">{alert.kind === 'missing_check_in' ? 'Not checked in by 9:30 AM' : 'Late arrival'}</span>
              <span className="text-[11px] text-slate-500">{alert.date}</span>
              <span className="text-[11px] text-slate-400">{alert.reason ? alert.reason.replaceAll('_', ' ') : 'delivered to the notification centre'}</span>
              <span className="ml-auto text-[10px] text-slate-400">{when(alert.createdAt)}</span>
            </div>
          ))}
          {!alerts.length && <div className="px-5 py-10 text-center"><Info size={20} className="mx-auto text-slate-300" /><div className="mt-2 text-xs font-semibold text-slate-500">No attendance alerts yet</div><div className="mt-1 text-[10px] text-slate-400">The 9:30 AM check runs automatically on working days.</div></div>}
        </div>
      </section>
    </div>
  );
}
