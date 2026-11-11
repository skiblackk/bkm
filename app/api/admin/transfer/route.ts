import { NextResponse } from 'next/server';
import { getDemoSession } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Ownership transfer. The administrator can hand the system-administrator role
 * to an existing user or provision a brand-new owner by email with a chosen
 * password, then transfer. The transfer itself is executed by the
 * `transfer_administrator` database function and recorded in admin_transfers.
 */
export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session?.isAdmin) return NextResponse.json({ error: 'Administrator access is required.' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.targetUserId ?? '').trim();
  const targetEmail = String(body.targetEmail ?? '').trim().toLowerCase();
  const targetFullName = String(body.targetFullName ?? '').trim();
  const targetPassword = String(body.targetPassword ?? '');
  const reason = String(body.reason ?? '').trim();
  if ((!targetUserId && !targetEmail) || !reason) return NextResponse.json({ error: 'A target user (or email) and a transfer reason are required.' }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();
  if (!supabase || !admin) return NextResponse.json({ error: 'Supabase Auth is not configured.' }, { status: 503 });

  try {
    let resolvedId = targetUserId;
    let resolvedName = targetFullName;

    if (!resolvedId) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) return NextResponse.json({ error: 'Enter a valid email address for the new owner.' }, { status: 400 });
      const { data: existingProfile } = await admin.from('profiles').select('id, full_name, active').eq('email', targetEmail).maybeSingle();
      if (existingProfile) {
        resolvedId = existingProfile.id;
        resolvedName = existingProfile.full_name;
      } else {
        if (!targetFullName) return NextResponse.json({ error: 'A full name is required when creating a new owner account.' }, { status: 400 });
        if (targetPassword.length < 8) return NextResponse.json({ error: 'Choose a password of at least 8 characters for the new owner.' }, { status: 400 });
        const { data: created, error: createError } = await admin.auth.admin.createUser({ email: targetEmail, password: targetPassword, email_confirm: true });
        if (createError || !created.user) return NextResponse.json({ error: createError?.message ?? 'The owner account could not be created.' }, { status: 400 });
        resolvedId = created.user.id;
        const { data: role } = await admin.from('roles').select('id').eq('name', 'Team Member').single();
        const initials = targetFullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
        const { error: profileError } = await admin.from('profiles').insert({ id: created.user.id, role_id: role?.id, full_name: targetFullName, email: targetEmail, initials, is_admin: false, active: true, is_demo: false });
        if (profileError) return NextResponse.json({ error: `Owner account created, but profile setup failed: ${profileError.message}` }, { status: 500 });
        await admin.from('user_permissions').insert(['view_dashboard', 'manage_clients', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'].map((permission_key) => ({ user_id: created.user.id, permission_key, granted_by: session.account })));
      }
    }

    if (targetPassword) {
      if (targetPassword.length < 8) return NextResponse.json({ error: 'The chosen password must be at least 8 characters.' }, { status: 400 });
      const { error: passwordError } = await admin.auth.admin.updateUserById(resolvedId, { password: targetPassword });
      if (passwordError) return NextResponse.json({ error: `The password could not be set: ${passwordError.message}` }, { status: 400 });
    }

    const { error } = await supabase.rpc('transfer_administrator', { target_user_id: resolvedId, transfer_reason: reason });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await admin.from('audit_events').insert({ actor_id: session.account, actor_name: session.name, actor_role: session.role, action: 'transfer_ownership', target_type: 'User', target_id: resolvedId, detail: `Ownership transferred to ${resolvedName || targetEmail}: ${reason}${targetPassword ? ' (password set by administrator)' : ''}`, severity: 'security' });

    return NextResponse.json({ targetUserId: resolvedId, message: `Administrator power transferred to ${resolvedName || targetEmail}. You are now a standard team member.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ownership transfer failed.' }, { status: 400 });
  }
}
