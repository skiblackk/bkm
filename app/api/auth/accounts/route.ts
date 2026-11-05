import { NextResponse } from 'next/server';
import { listDemoAccounts } from '@/lib/auth';
import { isProductionDataMode } from '@/lib/runtime-mode';

export async function GET() { if (isProductionDataMode) return NextResponse.json({ error: 'Demo account discovery is disabled in production.', accounts: [] }, { status: 503 }); return NextResponse.json({ accounts: listDemoAccounts() }); }
