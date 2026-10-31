import { NextResponse } from 'next/server';
import { listDemoAccounts } from '@/lib/auth';

export async function GET() { return NextResponse.json({ accounts: listDemoAccounts() }); }
