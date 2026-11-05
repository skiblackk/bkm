import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session?.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.targetUserId ?? '');
  const reason = String(body.reason ?? '').trim();
  if (!targetUserId || !reason) return NextResponse.json({ error: 'Target user and transfer reason are required.' }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const { error } = await supabase.rpc('transfer_administrator', { target_user_id: targetUserId, transfer_reason: reason });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ message: 'Administrator power transferred. The previous administrator is now a standard team member.' });
}
