import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { addJournalEntry, getAccounting, reverseJournalEntry, recordAudit } from '@/lib/data-access';
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

export async function POST(request: Request) {
  try {
    if (isProductionDataMode && !hasSupabaseConfiguration) return NextResponse.json({ error: 'The production Supabase repository is not configured.' }, { status: 503 });
    const session = await getDemoSession();
    if (!session?.isAdmin) return NextResponse.json({ error: 'Only an administrator can post or reverse journal entries.' }, { status: 403 });
    const input = await request.json() as { action?: string; reference?: string; entry?: unknown };
    if (input.action === 'reverse') {
      if (!input.reference) return NextResponse.json({ error: 'A journal reference is required.' }, { status: 400 });
      const accounting = await reverseJournalEntry(input.reference);
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'reverse_journal', targetType: 'JournalEntry', targetId: input.reference, detail: `Reversed posted journal ${input.reference}`, severity: 'change' });
      return NextResponse.json({ accounting });
    }
    const entry = entrySchema.parse(input.entry);
    const accounting = await addJournalEntry({ ...entry, status: 'Posted' });
    await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'post_journal', targetType: 'JournalEntry', targetId: entry.id, detail: `Posted journal ${entry.reference}`, severity: 'change' });
    return NextResponse.json({ accounting }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Accounting action failed.' }, { status: 400 }); }
}
