import { NextResponse } from 'next/server';
import { getAccounting, getMetrics, getSnapshot } from '@/lib/repository';

export async function GET() {
  const snapshot = getSnapshot();
  return NextResponse.json({ snapshot, metrics: getMetrics(snapshot), accounting: getAccounting(), source: 'server-side demonstration repository' });
}
