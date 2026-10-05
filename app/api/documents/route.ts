import { NextResponse } from 'next/server';
import { listUploadedDocuments, scanUploadedDocument } from '@/lib/uploaded-documents';

export const runtime = 'nodejs';
export async function GET(request: Request) { const clientId = new URL(request.url).searchParams.get('clientId') ?? undefined; return NextResponse.json({ documents: listUploadedDocuments(clientId) }); }
export async function POST(request: Request) {
  try { const form = await request.formData(); const file = form.get('file'); const clientId = String(form.get('clientId') ?? ''); const clientName = String(form.get('clientName') ?? ''); const instruction = String(form.get('instruction') ?? '').trim().slice(0, 1000); if (!(file instanceof File) || !clientId || !clientName) return NextResponse.json({ error: 'Choose a document and client before uploading.' }, { status: 400 }); if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'Documents must be 50 MB or smaller.' }, { status: 413 }); const result = await scanUploadedDocument({ clientId, clientName, filename: file.name, instruction, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) }); return NextResponse.json({ document: { ...result, extractedText: undefined } }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Document scan failed.' }, { status: 400 }); }
}
