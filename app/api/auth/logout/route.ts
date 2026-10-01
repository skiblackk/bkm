import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('bkm_demo_session', '', { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 0 });
  return response;
}
