'use client';

import { ArrowRight, CalendarDays, CircleAlert, FileText, ShieldCheck } from 'lucide-react';
import type { DashboardMetrics, DemoSnapshot } from '@/lib/types';
import type { AccountingSnapshot } from '@/lib/extended-types';
import { businessDate, businessDateLong } from '@/lib/business-clock';

type Props = {
  data: DemoSnapshot;
  metrics: DashboardMetrics;
  accounting: AccountingSnapshot | null;
  onNavigate: (view: 'tasks' | 'engagements' | 'reports' | 'clients') => void;
};

const money = (value: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(value);

export default function ExecutiveBrief({ data, metrics, accounting, onNavigate }: Props) {
  const overdue = data.tasks.filter((task) => task.status !== 'Completed' && new Date(task.dueDate).getTime() < new Date(`${businessDate()}T00:00:00+03:00`).getTime());
  const atRisk = data.engagements.filter((engagement) => engagement.status !== 'Completed' && engagement.progress < 60);
  const pendingQuotes = data.quotations.filter((quotation) => quotation.status === 'Draft' || quotation.status === 'Ready for review');
  const balanceState = accounting ? (accounting.balanceSheet.balanced ? 'Balanced' : 'Requires review') : 'Finance access restricted';

  return (
    <section className="executive-brief">
      <div className="executive-brief__header">
        <div>
          <div className="eyebrow text-gold/80">Executive overview · live accounts</div>
          <h1 className="mt-2 max-w-3xl text-[29px] font-semibold leading-[1.08] tracking-[-0.045em] text-white md:text-[38px]">The work that needs a decision today.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">A concise operating brief across delivery, people and the current financial record. Select any signal to investigate the source register.</p>
        </div>
        <div className="executive-brief__date">
          <CalendarDays size={16} className="text-gold" />
          <div><div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/45">Reporting date</div><div className="mt-1 text-sm font-semibold text-white">{businessDateLong()}</div><div className="mt-1 text-[11px] text-white/45">Nairobi · EAT</div></div>
        </div>
      </div>
      <div className="executive-brief__signals">
        <button type="button" onClick={() => onNavigate('tasks')} className="executive-signal"><span className="executive-signal__icon executive-signal__icon--danger"><CircleAlert size={16} /></span><span><strong>{overdue.length} overdue task{overdue.length === 1 ? '' : 's'}</strong><small>Open the task register</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => onNavigate('engagements')} className="executive-signal"><span className="executive-signal__icon executive-signal__icon--gold"><ShieldCheck size={16} /></span><span><strong>{atRisk.length} engagement{atRisk.length === 1 ? '' : 's'} need attention</strong><small>{metrics.upcomingDeadlines} deadlines in the review window</small></span><ArrowRight size={14} /></button>
        <button type="button" onClick={() => onNavigate('reports')} className="executive-signal"><span className="executive-signal__icon executive-signal__icon--teal"><FileText size={16} /></span><span><strong>{accounting ? `${money(accounting.incomeStatement.netProfit)} net profit` : 'Financial view restricted'}</strong><small>{balanceState} · {pendingQuotes.length} quotation{pendingQuotes.length === 1 ? '' : 's'} open</small></span><ArrowRight size={14} /></button>
      </div>
    </section>
  );
}
