import { NextResponse } from 'next/server';
import { getMetrics, getSnapshot } from '@/lib/repository';

export async function GET() {
  const snapshot = getSnapshot();
  return NextResponse.json({ snapshot, metrics: getMetrics(snapshot), source: 'server-side demonstration repository' });
}
