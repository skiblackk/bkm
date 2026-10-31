import { NextResponse } from 'next/server';
import { getAccounting } from '@/lib/repository';
import { financialPdf, financialXlsx } from '@/lib/exporters';
import { requirePermission } from '@/lib/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) { try { await requirePermission('view_finance'); const format = new URL(request.url).searchParams.get('format') ?? 'pdf'; const accounting = getAccounting(); if (format === 'xlsx') { const buffer = financialXlsx(accounting); return new NextResponse(buffer as BodyInit, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="bkm-financial-statements.xlsx"', 'Cache-Control': 'no-store' } }); } const buffer = await financialPdf(accounting); return new NextResponse(buffer as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="bkm-financial-statements.pdf"', 'Cache-Control': 'no-store' } }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Financial export access denied.' }, { status: 403 }); } }
