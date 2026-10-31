import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ session: null }, { status: 401 });
  return NextResponse.json({ session });
}
