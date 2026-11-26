import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { PERMISSION_CATALOGUE } from '@/lib/permission-catalogue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LABELS = new Map(PERMISSION_CATALOGUE.map((entry) => [entry.key, entry.description]));

/**
 * The permission-request queue the administrator acts on.
 *
 * Kept separate from /api/admin (which returns the whole dashboard payload) so
 * the queue can be polled every half minute without dragging the entire
 * snapshot with it.
 */
export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });

  const canDecide = session.isAdmin
    || hasPermission(session, 'assign_permissions')
    || hasPermission(session, 'revoke_permissions');
  if (!canDecide) return NextResponse.json({ error: 'Permission required: assign_permissions.' }, { status: 403 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });

  const { data, error } = await admin
    .from('approval_requests')
    .select('id, requested_by, requested_by_name, requested_by_role, reason, status, payload, created_at, decided_at, decided_by_name, decision_note, notified_admin_count')
    .eq('request_type', 'access_request')
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Names are joined here rather than trusted from the row: a request raised
  // before 021 has no stored name, and a renamed profile should show new.
  const ids = Array.from(new Set((data ?? []).map((row) => String(row.requested_by)).filter(Boolean)));
  const names = new Map<string, { name: string; role: string }>();
  if (ids.length) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name, roles(name)').in('id', ids);
    for (const profile of profiles ?? []) {
      const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
      names.set(String(profile.id), {
        name: String(profile.full_name ?? 'Staff member'),
        role: String((role as { name?: string } | null)?.name ?? 'Team member'),
      });
    }
  }

  const requests = (data ?? []).map((row) => {
    const permission = String((row.payload as { permission?: string } | null)?.permission ?? '');
    const person = names.get(String(row.requested_by));
    return {
      id: String(row.id),
      requestedByName: String(row.requested_by_name ?? person?.name ?? 'Staff member'),
      requestedByRole: String(row.requested_by_role ?? person?.role ?? 'Team member'),
      permission,
      permissionLabel: LABELS.get(permission) ?? permission.replace(/_/g, ' '),
      reason: String(row.reason ?? ''),
      status: String(row.status),
      createdAt: String(row.created_at),
      decidedAt: row.decided_at ? String(row.decided_at) : null,
      decidedByName: row.decided_by_name ? String(row.decided_by_name) : null,
      decisionNote: row.decision_note ? String(row.decision_note) : null,
      notifiedAdminCount: Number(row.notified_admin_count ?? 0),
    };
  });

  return NextResponse.json({
    requests,
    counts: {
      pending: requests.filter((row) => row.status === 'Pending').length,
      approved: requests.filter((row) => row.status === 'Approved').length,
      rejected: requests.filter((row) => row.status === 'Rejected').length,
    },
    canDecide,
  });
}
