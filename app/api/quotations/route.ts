import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { isPermissionError } from '@/lib/permissions';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import { listQuotations, getQuotation, expireLapsedQuotations } from '@/lib/quotation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/quotations — the register, with every line, trail and delivery. */
export async function GET(request: Request) {
  try {
    if (!hasSupabaseConfiguration) {
      return NextResponse.json({ error: 'The production repository is not configured.' }, { status: 503 });
    }
    const session = await requirePermission('view_finance');
    const actor = { id: session.staffId ?? null, name: session.name };

    // Opening the register is also when lapsed validity is swept.
    const expired = await expireLapsedQuotations(actor).catch(() => [] as string[]);

    // ?id=… returns one quotation in full; the register alone is enough for the
    // list, so the detail request is kept narrow.
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const quotation = await getQuotation(id, request);
      if (!quotation) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
      return NextResponse.json({ quotation, expired });
    }

    const quotations = await listQuotations(request);

    return NextResponse.json({
      quotations,
      expired,
      statuses: ['Draft', 'Sent', 'Viewed', 'Accepted', 'Rejected', 'Expired'],
    });
  } catch (error) {
    if (isPermissionError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Quotations could not be read.' }, { status: 500 });
  }
}
