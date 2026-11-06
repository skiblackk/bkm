import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getDemoSession();
  if (!session?.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, initials, is_admin, active, approval_status, created_at, roles(name)').order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Unable to load authorised profiles.' }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session?.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body.action === 'approve' || body.action === 'reject') {
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required.' }, { status: 503 });
    const userId = String(body.userId ?? '');
    if (!userId) return NextResponse.json({ error: 'userId is required.' }, { status: 400 });
    const approved = body.action === 'approve';
    const { error } = await admin.from('profiles').update({ approval_status: approved ? 'approved' : 'rejected', approved_at: approved ? new Date().toISOString() : null, approved_by: approved ? session.account : null }).eq('id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from('audit_events').insert({ actor_id: session.account, event_type: approved ? 'account.approved' : 'account.rejected', description: `Account ${approved ? 'approved' : 'declined'} by administrator.`, target_type: 'profile', target_id: userId, severity: 'info' }).then(() => undefined, () => undefined);
    return NextResponse.json({ message: approved ? 'The account is approved. The user can sign in now.' : 'The account was declined.' });
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.fullName ?? '').trim();
  const password = String(body.password ?? '');
  const makeAdmin = body.makeAdmin === true;
  if (!email || !fullName) return NextResponse.json({ error: 'Full name and work email are required.' }, { status: 400 });
  if (password && password.length < 8) return NextResponse.json({ error: 'The chosen password must be at least 8 characters.' }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for administrator-controlled invitations.' }, { status: 503 });
  const { data: role, error: roleError } = await admin.from('roles').select('id, name').eq('name', makeAdmin ? 'System Administrator' : 'Team Member').single();
  if (roleError || !role) return NextResponse.json({ error: 'The requested role is not configured.' }, { status: 503 });
  let userId: string;
  if (password) {
    const { data: invited, error: inviteError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message ?? 'Unable to create the user.' }, { status: 400 });
    userId = invited.user.id;
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${new URL(request.url).origin}/auth/callback` });
    if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message ?? 'Unable to invite the user.' }, { status: 400 });
    userId = invited.user.id;
  }
  const initials = fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  const { error: profileError } = await admin.from('profiles').insert({ id: userId, role_id: role.id, full_name: fullName, email, initials, is_admin: makeAdmin, active: true, is_demo: false, approval_status: 'approved', approved_at: new Date().toISOString() });
  if (profileError) return NextResponse.json({ error: `User ${password ? 'created' : 'invited'}, but profile creation failed: ${profileError.message}` }, { status: 500 });
  return NextResponse.json({ user: { id: userId, email, fullName, role: role.name, isAdmin: makeAdmin }, message: password ? 'Account created. The user can sign in immediately with the password you chose.' : 'Invitation sent. The user must establish their own password from the email.' }, { status: 201 });
}
