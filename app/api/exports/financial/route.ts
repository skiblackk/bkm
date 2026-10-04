import { NextResponse } from 'next/server';
import { getAccounting } from '@/lib/repository';
import { financialPdf, financialXlsx } from '@/lib/exporters';
export const runtime = 'nodejs';
export async function GET(request: Request) { const format = new URL(request.url).searchParams.get('format') ?? 'pdf'; const accounting = getAccounting(); if (format === 'xlsx') { const buffer = financialXlsx(accounting); return new NextResponse(buffer as BodyInit, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="bkm-financial-statements.xlsx"', 'Cache-Control': 'no-store' } }); } const buffer = await financialPdf(accounting); return new NextResponse(buffer as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="bkm-financial-statements.pdf"', 'Cache-Control': 'no-store' } }); }
