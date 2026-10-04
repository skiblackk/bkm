import { NextResponse } from 'next/server';
import { getDemoAccount } from '@/lib/auth';
import { recordAudit } from '@/lib/repository';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const session = getDemoAccount(body.account);
  if (!session) return NextResponse.json({ error: 'Select a seeded demonstration account.' }, { status: 400 });
  recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'sign_in', targetType: 'Session', targetId: session.account, detail: `${session.name} signed in`, severity: 'info' });
  const response = NextResponse.json({ session });
  const origin = request.headers.get('origin') ?? '';
  const securePreview = origin.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https';
  response.cookies.set('bkm_demo_session', body.account, { httpOnly: true, sameSite: securePreview ? 'none' : 'lax', secure: securePreview, path: '/', maxAge: 60 * 60 * 8 });
  return response;
}
