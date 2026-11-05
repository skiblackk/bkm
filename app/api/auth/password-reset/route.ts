import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Work email is required.' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  if (error) return NextResponse.json({ error: 'Password reset is not currently available.' }, { status: 503 });
  return NextResponse.json({ message: 'If the account exists, a password reset email has been sent.' });
}
