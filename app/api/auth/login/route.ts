import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureAccountApproved, getDemoSession } from '@/lib/auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return NextResponse.json({ error: 'Work email and password are required.' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  const session = await getDemoSession();
  if (!session) { await supabase.auth.signOut(); return NextResponse.json({ error: 'Your account is authenticated but has no active BKM profile. Ask an administrator to provision access.' }, { status: 403 }); }
  const approval = await ensureAccountApproved(session.account);
  if (!approval.ok) { await supabase.auth.signOut(); return NextResponse.json({ error: approval.message }, { status: 403 }); }
  return NextResponse.json({ session });
}
