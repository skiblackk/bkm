import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getDemoSession } from '@/lib/auth';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const fullName = String(body.fullName ?? '').trim().replace(/\s+/g, ' ');
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (fullName.length < 2 || fullName.length > 120) return NextResponse.json({ error: 'Enter your full name.' }, { status: 400 });
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Enter a valid work email address.' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: 'Use a password with at least 8 characters.' }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured for this website.' }, { status: 503 });

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data.user) return NextResponse.json({ error: 'Supabase did not create the account.' }, { status: 502 });
  if (!data.user.identities?.length) return NextResponse.json({ error: 'An account with this email already exists. Sign in instead.' }, { status: 409 });

  const session = await getDemoSession();
  if (session) {
    return NextResponse.json({
      session,
      firstAdmin: session.isAdmin,
      message: session.isAdmin
        ? 'Account created. You are the initial BKM administrator.'
        : 'Account created. An administrator must approve your access before you can enter the workspace.',
    }, { status: 201 });
  }

  return NextResponse.json({
    session: null,
    firstAdmin: false,
    message: 'Account created. Check your email to confirm the account, then sign in. The first registered BKM account becomes the administrator; later accounts wait for administrator approval.',
  }, { status: 202 });
}
