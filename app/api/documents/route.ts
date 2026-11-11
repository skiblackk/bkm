import { NextResponse } from 'next/server';
import { listUploadedDocuments, scanUploadedDocument } from '@/lib/uploaded-documents';
import { getDemoSession, requirePermission } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const session = await requirePermission('manage_documents');
    const clientId = new URL(request.url).searchParams.get('clientId') ?? undefined;
    const documents = await listUploadedDocuments({ ownerId: session.account, clientId });
    return NextResponse.json({ documents });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Document access denied.' }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission('manage_documents');
    const form = await request.formData();
    const file = form.get('file');
    const clientId = String(form.get('clientId') ?? '').trim();
    const clientName = String(form.get('clientName') ?? '').trim();
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose a document to upload.' }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'Documents must be 25 MB or smaller.' }, { status: 413 });
    const result = await scanUploadedDocument({
      ownerId: (await getDemoSession())?.account ?? session.account,
      clientId: clientId || 'unassigned',
      clientName: clientName || 'Unassigned',
      filename: file.name,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    const { extractedText: _text, grid: _grid, analysis, ...document } = result;
    // The computed statements travel with the document so the panel can show
    // real figures without a second round trip.
    return NextResponse.json({ document: { ...document, analysis } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Document scan failed.';
    const status = /sign in|permission|authorized|denied/i.test(message) ? 403 : /required|choose|format|unsupported|larger|size|Upload a/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
