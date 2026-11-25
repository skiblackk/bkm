'use client';

/**
 * Small presentational pieces used by more than one screen.
 *
 * These lived inside workspace-app.tsx, which made them unreachable from any
 * component extracted out of it. One definition here beats a copy that drifts.
 */

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'teal' | 'amber' | 'danger' | 'purple' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
    purple: 'bg-violet-50 text-violet-700',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-4"><div>{eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}<h2 className="section-title">{title}</h2></div>{action}</div>;
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="eyebrow mb-2">{eyebrow}</div><h1 className="text-[28px] font-semibold tracking-[-0.045em]">{title}</h1><p className="mt-2 text-sm text-slate-500">{description}</p></div>{action}</div>; }
