import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { isPermissionError } from '@/lib/permissions';
import { hasSupabaseConfiguration } from '@/lib/runtime-mode';
import { getQuotation, storeQuotationPdf, renderQuotationPdf, documentInput, snapshotRevision, recordShare } from '@/lib/quotation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/quotations/pdf?id=…&mode=inline|download
 *
 * Renders the client-facing PDF. The first render for a revision is stored in
 * the private bucket and snapshotted, so the copy the client receives is the
 * copy the firm keeps.
 */
export async function GET(request: Request) {
  try {
    if (!hasSupabaseConfiguration) return NextResponse.json({ error: 'The production repository is not configured.' }, { status: 503 });
    const session = await requirePermission('issue_quotations');
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const mode = new URL(request.url).searchParams.get('mode') ?? 'download';
    if (!id) return NextResponse.json({ error: 'A quotation reference is required.' }, { status: 400 });

    const quotation = await getQuotation(id, request);
    if (!quotation) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });

    const actor = { id: session.staffId ?? null, name: session.name };
    const buffer = await renderQuotationPdf(documentInput(quotation, session.name));

    // Storing and snapshotting are what make the document permanent; a storage
    // failure must not stop the client from getting their quotation, so it is
    // attempted and reported rather than thrown.
    let stored = true;
    try {
      await storeQuotationPdf(quotation, buffer, actor);
      await snapshotRevision(quotation, actor, quotation.status === 'Draft' ? 'Draft rendered' : 'Issued to client');
    } catch {
      stored = false;
    }

    if (mode === 'download') {
      await recordShare({
        quotationId: quotation.id,
        revision: quotation.revision,
        channel: 'download',
        recipient: null,
        subject: quotation.number,
        body: null,
        actor,
      }).catch(() => undefined);
    }

    const filename = `${quotation.number}-rev${quotation.revision}.pdf`;
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${mode === 'inline' ? 'inline' : 'attachment'}; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Quotation-Stored': stored ? 'yes' : 'no',
      },
    });
  } catch (error) {
    if (isPermissionError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The quotation PDF could not be produced.' }, { status: 500 });
  }
}
