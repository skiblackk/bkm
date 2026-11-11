import { NextResponse } from 'next/server';
import { productionReadiness } from '@/lib/runtime-mode';

export const dynamic = 'force-dynamic';

export function GET() {
  const readiness = productionReadiness();
  return NextResponse.json({ status: readiness.realRepositoryConnected ? 'ok' : 'not_ready', service: 'bkm-operations-hub', readiness }, { status: readiness.realRepositoryConnected ? 200 : 503 });
}
