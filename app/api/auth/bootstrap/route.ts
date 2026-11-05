import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authenticate with Supabase before establishing the first administrator.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const fullName = String(body.fullName ?? '').trim();
  if (!fullName) return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  const { data, error } = await supabase.rpc('bootstrap_first_admin', { target_user_id: user.id, target_full_name: fullName });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ profile: data, message: 'You are now the initial administrator.' }, { status: 201 });
}
