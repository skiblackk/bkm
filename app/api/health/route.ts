import { NextResponse } from 'next/server';
import { productionReadiness } from '@/lib/runtime-mode';

export const dynamic = 'force-dynamic';

export function GET() {
  const readiness = productionReadiness();
  return NextResponse.json({ status: readiness.mode === 'demo' || readiness.realRepositoryConnected ? 'ok' : 'not_ready', service: 'bkm-operations-hub', readiness }, { status: readiness.mode === 'production' && !readiness.realRepositoryConnected ? 503 : 200 });
}
