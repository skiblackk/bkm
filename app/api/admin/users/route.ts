import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getDemoSession();
  if (!session?.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, initials, is_admin, active, roles(name)').order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Unable to load authorised profiles.' }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session?.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.fullName ?? '').trim();
  const makeAdmin = body.makeAdmin === true;
  if (!email || !fullName) return NextResponse.json({ error: 'Full name and work email are required.' }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for administrator-controlled invitations.' }, { status: 503 });
  const { data: role, error: roleError } = await admin.from('roles').select('id, name').eq('name', makeAdmin ? 'System Administrator' : 'Team Member').single();
  if (roleError || !role) return NextResponse.json({ error: 'The requested role is not configured.' }, { status: 503 });
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${new URL(request.url).origin}/auth/callback` });
  if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message ?? 'Unable to invite the user.' }, { status: 400 });
  const initials = fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  const { error: profileError } = await admin.from('profiles').insert({ id: invited.user.id, role_id: role.id, full_name: fullName, email, initials, is_admin: makeAdmin, active: true, is_demo: false });
  if (profileError) return NextResponse.json({ error: `User invited, but profile creation failed: ${profileError.message}` }, { status: 500 });
  return NextResponse.json({ user: { id: invited.user.id, email, fullName, role: role.name, isAdmin: makeAdmin }, message: 'Invitation sent. The user must establish their own password from the email.' }, { status: 201 });
}
