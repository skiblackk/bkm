import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { getEffectiveAccess, assertKnownPermissionKeys, PermissionError } from '@/lib/permissions';
import { PERMISSION_CATALOGUE, ROLE_TEMPLATES } from '@/lib/permission-catalogue';
import { recordAudit, getAuditEvents } from '@/lib/data-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isProductionDataMode } from '@/lib/runtime-mode';

export async function GET(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const target = new URL(request.url).searchParams.get('userId') ?? session.account;
  const reviewingOther = target !== session.account;
  if (reviewingOther && !hasPermission(session, 'assign_permissions') && !hasPermission(session, 'view_user_directory')) {
    return NextResponse.json({ error: 'Permission required: assign_permissions or view_user_directory.' }, { status: 403 });
  }
  const access = await getEffectiveAccess(target);
  if (!access) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const admin = createSupabaseAdminClient();
  let roles: Array<{ id: string; name: string; description: string; is_system_role: boolean; is_active: boolean }> = [];
  let roleGrants: Array<{ role: string; permission_key: string }> = [];
  if (admin) {
    const { data: roleRows } = await admin.from('roles').select('id, name, description, is_system_role, is_active').order('name');
    roles = (roleRows ?? []) as typeof roles;
    const { data: grantRows } = await admin.from('role_permissions').select('roles(name), permissions(permission_key)');
    roleGrants = (grantRows ?? []).map((row) => {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
      return { role: (role as { name?: string })?.name ?? '', permission_key: (perm as { permission_key?: string })?.permission_key ?? '' };
    }).filter((row) => row.role && row.permission_key);
  }
  return NextResponse.json({
    catalogue: PERMISSION_CATALOGUE,
    templates: ROLE_TEMPLATES,
    roles,
    roleGrants,
    effective: {
      userId: access.userId,
      isAdmin: access.isAdmin,
      isActive: access.isActive,
      approvalStatus: access.approvalStatus,
      roleNames: access.roleNames,
      permissions: Array.from(access.permissions).sort(),
      userGrants: access.userGrants,
      roleGrants: access.roleGrants,
    },
  });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  try {
    const input = await request.json();
    if (!isProductionDataMode) return NextResponse.json({ error: 'Role management is available in production mode.' }, { status: 400 });
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

    if (input.action === 'create-role' || input.action === 'update-role') {
      if (!hasPermission(session, 'manage_roles')) return NextResponse.json({ error: 'Permission required: manage_roles.' }, { status: 403 });
      const name = String(input.name ?? '').trim();
      const description = String(input.description ?? '').trim();
      const permissions = assertKnownPermissionKeys(input.permissions);
      if (input.action === 'create-role') {
        if (!name) return NextResponse.json({ error: 'A role name is required.' }, { status: 400 });
        const { data: role, error } = await admin.from('roles').insert({ name, description, is_system_role: false, is_active: true }).select('id, name, description, is_system_role, is_active').single();
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        if (permissions.length) await admin.from('role_permissions').insert(permissions.map((permission_key) => ({ role_id: role.id, permission_key }))).then((r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); });
        await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'create_role', targetType: 'Role', targetId: role.id, detail: `Role ${name} created with ${permissions.length} permissions`, severity: 'security' });
        return NextResponse.json({ role, audit: await getAuditEvents() });
      }
      const roleId = String(input.roleId ?? '');
      const { data: role } = await admin.from('roles').select('id, name, is_system_role').eq('id', roleId).maybeSingle();
      if (!role) return NextResponse.json({ error: 'Unknown role.' }, { status: 404 });
      await admin.from('roles').update({ description, is_active: input.isActive !== false, updated_at: new Date().toISOString() }).eq('id', roleId);
      await admin.from('role_permissions').delete().eq('role_id', roleId);
      if (permissions.length) await admin.from('role_permissions').insert(permissions.map((permission_key) => ({ role_id: roleId, permission_key })));
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'update_role', targetType: 'Role', targetId: roleId, detail: `Role ${role.name} updated: ${permissions.length} permissions`, severity: 'security' });
      return NextResponse.json({ audit: await getAuditEvents() });
    }
    return NextResponse.json({ error: 'Unsupported permissions action.' }, { status: 400 });
  } catch (error) {
    const status = error instanceof PermissionError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Permissions action failed.' }, { status });
  }
}
