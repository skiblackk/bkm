import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const supabase = await createSupabaseServerClient();
  if (supabase && code) await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
