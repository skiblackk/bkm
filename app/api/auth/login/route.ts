import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureAccountApproved, getDemoSession } from '@/lib/auth';
import {
  THROTTLE_MESSAGE,
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/lib/rate-limit';

/**
 * Client address for throttling (BKM-02).
 *
 * Vercel sets x-forwarded-for itself and a client cannot forge the left-most
 * entry, but on a self-hosted deployment the header is caller-controlled, so
 * this only ever narrows the counter key — the per-account counter is what
 * carries the security weight and does not depend on this value being true.
 */
function clientAddress(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function throttled(seconds: number) {
  return NextResponse.json(
    { error: THROTTLE_MESSAGE },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return NextResponse.json({ error: 'Work email and password are required.' }, { status: 400 });

  const ip = clientAddress(request);

  // Refuse before touching Supabase: an attempt inside the backoff window costs
  // one map lookup rather than an outbound auth request.
  const allowed = checkLoginAllowed(email, ip);
  if (!allowed.allowed) return throttled(allowed.retryAfterSeconds);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Counted before the response goes out, so the fifth wrong password is
    // already inside the first backoff window.
    const after = recordLoginFailure(email, ip);
    if (!after.allowed) return throttled(after.retryAfterSeconds);
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }
  recordLoginSuccess(email);

  const session = await getDemoSession();
  if (!session) { await supabase.auth.signOut(); return NextResponse.json({ error: 'Your account is authenticated but has no active BKM profile. Ask an administrator to provision access.' }, { status: 403 }); }
  const approval = await ensureAccountApproved(session.account);
  if (!approval.ok) { await supabase.auth.signOut(); return NextResponse.json({ error: approval.message }, { status: 403 }); }
  return NextResponse.json({ session });
}
