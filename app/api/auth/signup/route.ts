import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function initials(fullName: string) {
  return fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * Self sign-up. The first account ever created becomes the administrator.
 * Every later account is created in a pending state and must be approved by
 * an administrator before it can access the workspace.
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

  // The assignable roles exclude every privileged template — those come only
  // from the bootstrap, an administrator assignment or an ownership transfer.
  const PRIVILEGED_ROLES = new Set(['System Administrator', 'CEO / Managing Partner', 'Managing Partner', 'CEO', 'Administrator']);
  const { data: roles, error: rolesError } = await admin.from('roles').select('id, name').order('name');
  if (rolesError) return NextResponse.json({ error: 'Unable to load the role list.' }, { status: 503 });
  const assignable = (roles ?? []).filter((role) => !PRIVILEGED_ROLES.has(role.name));
  const chosen = assignable.find((role) => role.name.toLowerCase() === roleTitle.toLowerCase());
  const fallback = assignable.find((role) => role.name === 'Team Member') ?? assignable[0];
  const role = chosen ?? fallback;
  if (!role) return NextResponse.json({ error: 'No assignable role is configured.' }, { status: 503 });

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError || !created.user) {
    const message = /already|exists/i.test(createError?.message ?? '') ? 'An account with this email already exists. Sign in instead.' : (createError?.message ?? 'Unable to create the account.');
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const userId = created.user.id;

  const { data: provisioned, error: provisionError } = await admin.rpc('provision_bkm_signup_profile', {
    target_user_id: userId,
    target_full_name: fullName,
    target_email: email,
    target_role_id: role.id,
  });
  if (provisionError || !provisioned) {
    return NextResponse.json({ error: `Account created, but profile provisioning failed: ${provisionError?.message ?? 'No provisioning result.'}` }, { status: 500 });
  }
  const isFirstAdministrator = Boolean((provisioned as { is_first?: boolean }).is_first);
  const roleName = isFirstAdministrator ? 'System Administrator' : role.name;
  await admin.from('audit_events').insert({ actor_id: userId, actor_name: fullName, actor_role: roleName, action: isFirstAdministrator ? 'account.bootstrap' : 'account.signup', target_type: 'profile', target_id: userId, detail: isFirstAdministrator ? `First administrator account established for ${fullName}.` : `${fullName} signed up as ${role.name} — awaiting administrator approval.`, severity: 'info' }).then(() => undefined, () => undefined);
  await admin.from('activity_logs').insert({ actor_id: userId, actor_name: fullName, event_type: isFirstAdministrator ? 'account.bootstrap' : 'account.signup', description: isFirstAdministrator ? `First administrator account established for ${fullName}.` : `${fullName} signed up as ${role.name} — awaiting administrator approval.`, record_type: 'profile', record_id: userId }).then(() => undefined, () => undefined);
  if (isFirstAdministrator) return NextResponse.json({ status: 'admin', message: 'Welcome — you are the administrator. Signing you in…' }, { status: 201 });
  return NextResponse.json({ status: 'pending', message: 'Account created. An administrator must approve access before you can enter the workspace.' }, { status: 201 });
}
