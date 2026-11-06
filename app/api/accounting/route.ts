import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { addJournalEntry, getAccounting, reverseJournalEntry, recordAudit, updateJournalStatus } from '@/lib/data-access';
import { isProductionDataMode, hasSupabaseConfiguration } from '@/lib/runtime-mode';

const lineSchema = z.object({ accountId: z.string().min(1), debit: z.number().finite().nonnegative(), credit: z.number().finite().nonnegative() }).refine((line) => !(line.debit > 0 && line.credit > 0), 'A journal line cannot contain both debit and credit.');
const entrySchema = z.object({ id: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().trim().min(1).max(240), reference: z.string().trim().min(1).max(80), lines: z.array(lineSchema).min(2).max(50) });

export async function GET(request: Request) {
  if (isProductionDataMode && !hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
  const session = await getDemoSession();
  if (!session || !hasPermission(session, 'view_finance')) return NextResponse.json({ error: 'Finance permission is required.' }, { status: 403 });
  const url = new URL(request.url); const periodStart = url.searchParams.get('periodStart') ?? undefined; const periodEnd = url.searchParams.get('periodEnd') ?? undefined;
  return NextResponse.json({ accounting: await getAccounting({ periodStart, periodEnd }) });
}

/**
 * Journal workflow. Segregation of duties is enforced here, server-side:
 * the person who prepares or submits an entry can never approve or post it,
 * even if they hold every finance permission. Administrators keep an explicit
 * break-glass path, but it is audit-logged with the reason and is visible in
 * the entry history — it does not silently bypass the control.
 */
export async function POST(request: Request) {
  try {
    if (isProductionDataMode && !hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
    const session = await getDemoSession();
    if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
    const input = await request.json() as { action?: string; reference?: string; entry?: unknown; reason?: string; overrideReason?: string };
    const action = input.action ?? 'post';

    if (action === 'reverse') {
      if (!hasPermission(session, 'reverse_journal_entries')) return NextResponse.json({ error: 'You do not have permission to reverse journal entries.' }, { status: 403 });
      if (!input.reference) return NextResponse.json({ error: 'A journal reference is required.' }, { status: 400 });
      const accounting = await reverseJournalEntry(input.reference);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'reverse_journal', targetType: 'JournalEntry', targetId: input.reference, detail: `Reversed posted journal ${input.reference}${input.reason ? ` — reason: ${input.reason}` : ''}`, severity: 'change' });
      return NextResponse.json({ accounting });
    }

    // draft | submit | approve | post
    if (action === 'draft') {
      if (!hasPermission(session, 'create_journal_entries')) return NextResponse.json({ error: 'You do not have permission to prepare journal entries.' }, { status: 403 });
      const entry = entrySchema.parse(input.entry);
      const accounting = await addJournalEntry({ ...entry, status: 'Draft' }, session.account);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'create_journal_draft', targetType: 'JournalEntry', targetId: entry.id, detail: `Prepared draft journal ${entry.reference}`, severity: 'change' });
      return NextResponse.json({ accounting }, { status: 201 });
    }

    const transition: Record<string, { from: string[]; to: string; permission: string; verb: string }> = {
      submit: { from: ['Draft'], to: 'Submitted', permission: 'submit_journal_entries', verb: 'submit_journal' },
      approve: { from: ['Submitted'], to: 'Approved', permission: 'approve_journal_entries', verb: 'approve_journal' },
      post: { from: ['Approved'], to: 'Posted', permission: 'post_journal_entries', verb: 'post_journal' },
    };
    if (!transition[action]) return NextResponse.json({ error: `Unknown accounting action: ${action}.` }, { status: 400 });
    const rule = transition[action];
    if (!hasPermission(session, rule.permission)) return NextResponse.json({ error: `You do not have permission to ${action} journal entries.` }, { status: 403 });
    if (!input.reference) return NextResponse.json({ error: 'A journal reference is required.' }, { status: 400 });

    const result = await updateJournalStatus(input.reference, { to: rule.to, from: rule.from, actorId: session.account, actorName: session.name, isAdmin: session.isAdmin, overrideReason: input.overrideReason });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
    await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: rule.verb, targetType: 'JournalEntry', targetId: input.reference, detail: `${rule.verb.replace('_', ' ')} ${input.reference}${result.sodOverride ? ` — ADMIN OVERRIDE of segregation of duties (preparer ${result.preparedBy}); reason: ${input.overrideReason}` : ''}`, severity: result.sodOverride ? 'security' : 'change' });
    return NextResponse.json({ accounting: result.accounting, status: rule.to, sodOverride: Boolean(result.sodOverride) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Accounting action failed.' }, { status: 400 }); }
}
