import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const BASELINE_PERMISSIONS = ['view_dashboard', 'use_assistant', 'send_messages'];

function initials(fullName: string) {
  return fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * Self sign-up. The first account ever created becomes the administrator
 * (restricted to BKM_FIRST_ADMIN_EMAIL when that variable is set, so nobody
 * can claim ownership before the real owner signs up). Every other account is
 * created in a pending state: an administrator approves it, or access is
 * granted automatically four hours after sign-up.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const fullName = String(body.fullName ?? '').trim();
  const roleTitle = String(body.role ?? 'Team Member').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'A valid work email is required.' }, { status: 400 });
  if (!fullName) return NextResponse.json({ error: 'Your full name is required.' }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: 'The password must be at least 8 characters.' }, { status: 400 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

  // The assignable roles are every role except System Administrator — that one
  // comes only from the bootstrap or an explicit ownership transfer.
  const { data: roles, error: rolesError } = await admin.from('roles').select('id, name').neq('name', 'System Administrator').order('name');
  if (rolesError) return NextResponse.json({ error: 'Unable to load the role list.' }, { status: 503 });
  const chosen = (roles ?? []).find((role) => role.name.toLowerCase() === roleTitle.toLowerCase());
  const fallback = (roles ?? []).find((role) => role.name === 'Team Member') ?? (roles ?? [])[0];
  const role = chosen ?? fallback;
  if (!role) return NextResponse.json({ error: 'No assignable role is configured.' }, { status: 503 });

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) {
    const message = /already|exists/i.test(createError?.message ?? '') ? 'An account with this email already exists. Sign in instead.' : (createError?.message ?? 'Unable to create the account.');
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const userId = created.user.id;

  const [{ count: adminCount }] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('is_admin', true),
  ]);
  const ownerEmail = (process.env.BKM_FIRST_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const bootstrap = (adminCount ?? 0) === 0 && (ownerEmail === '' || ownerEmail === email);

  if (bootstrap) {
    const { data: sysRole } = await admin.from('roles').select('id').eq('name', 'System Administrator').single();
    if (!sysRole) return NextResponse.json({ error: 'The System Administrator role is not configured.' }, { status: 503 });
    const { error: profileError } = await admin.from('profiles').insert({
      id: userId, role_id: sysRole.id, full_name: fullName, email, initials: initials(fullName),
      is_admin: true, active: true, is_demo: false, approval_status: 'approved', approved_at: new Date().toISOString(),
    });
    if (profileError) return NextResponse.json({ error: `Account created, but profile creation failed: ${profileError.message}` }, { status: 500 });
    await admin.from('audit_events').insert({ actor_id: userId, event_type: 'account.bootstrap', description: `First administrator account established for ${fullName}.`, target_type: 'profile', severity: 'info' }).then(() => undefined, () => undefined);
    return NextResponse.json({ status: 'admin', message: 'Welcome — you are the administrator. Signing you in…' }, { status: 201 });
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: userId, role_id: role.id, full_name: fullName, email, initials: initials(fullName),
    is_admin: false, active: true, is_demo: false, approval_status: 'pending',
  });
  if (profileError) return NextResponse.json({ error: `Account created, but profile creation failed: ${profileError.message}` }, { status: 500 });
  await admin.from('user_permissions').insert(BASELINE_PERMISSIONS.map((permission_key) => ({ user_id: userId, permission_key }))).then(() => undefined, () => undefined);
  await admin.from('audit_events').insert({ actor_id: userId, event_type: 'account.signup', description: `${fullName} signed up as ${role.name} — awaiting approval.`, target_type: 'profile', severity: 'info' }).then(() => undefined, () => undefined);
  return NextResponse.json({ status: 'pending', message: 'Account created. An administrator will review it — or access is granted automatically 4 hours after sign-up.' }, { status: 201 });
}
