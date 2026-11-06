import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const BASELINE_PERMISSIONS = ['view_dashboard', 'use_assistant', 'send_messages'];

/**
 * Public self sign-up. Creates a confirmed Supabase account with the chosen
 * password plus an active BKM profile (Team Member role with baseline
 * permissions). Administrators can adjust access afterwards from the user
 * controls, and the sign-up audit trail records the provisioning.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const fullName = String(body.fullName ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!fullName || !email || !password) return NextResponse.json({ error: 'Full name, work email and password are required.' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid work email address.' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: 'The password must be at least 8 characters.' }, { status: 400 });
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: 'Account sign-up requires the server Supabase configuration.' }, { status: 503 });

    const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing) return NextResponse.json({ error: 'An account with this email already exists. Sign in instead.' }, { status: 409 });

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) return NextResponse.json({ error: createError?.message ?? 'The account could not be created.' }, { status: 400 });

    const { data: role } = await admin.from('roles').select('id').eq('name', 'Team Member').single();
    const initials = fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, role_id: role?.id, full_name: fullName, email, initials, is_admin: false, active: true, is_demo: false });
    if (profileError) return NextResponse.json({ error: `Account created, but profile setup failed: ${profileError.message}` }, { status: 500 });

    const permissionRows = BASELINE_PERMISSIONS.map((permission_key) => ({ user_id: created.user.id, permission_key, granted_by: created.user.id }));
    const { error: permissionError } = await admin.from('user_permissions').insert(permissionRows);
    if (permissionError) return NextResponse.json({ error: `Account created, but permission setup failed: ${permissionError.message}` }, { status: 500 });

    await admin.from('audit_events').insert({ actor_id: created.user.id, actor_name: fullName, actor_role: 'Team Member', action: 'sign_up', target_type: 'User', target_id: created.user.id, detail: `${fullName} signed up with baseline team permissions`, severity: 'security' });

    return NextResponse.json({ created: true, message: 'Account created. You can sign in now.' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sign-up failed.' }, { status: 500 });
  }
}
