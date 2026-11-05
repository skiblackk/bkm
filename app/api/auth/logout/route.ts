import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  const response = NextResponse.json({ ok: true });
  const origin = request.headers.get('origin') ?? '';
  const securePreview = origin.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https';
  response.cookies.set('bkm_demo_session', '', { httpOnly: true, sameSite: securePreview ? 'none' : 'lax', secure: securePreview, path: '/', maxAge: 0 });
  return response;
}
