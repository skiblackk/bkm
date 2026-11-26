import { NextResponse } from 'next/server';
import { getDemoSession, hasPermission } from '@/lib/auth';
import { recordAudit, getAuditEvents } from '@/lib/data-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

export async function GET() {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
  const admin = db();
  const seesAll = hasPermission(session, 'assign_permissions') || hasPermission(session, 'approve_reports');
  const query = admin.from('approval_requests').select('*').order('created_at', { ascending: false }).limit(100);
  const { data, error } = await (seesAll ? query : query.or(`requested_by.eq.${session.account},assigned_approver.eq.${session.account}`));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const session = await getDemoSession();
  if (!session) return NextResponse.json({ error: 'Sign-in is required.' }, { status: 401 });
 
  try {
    const input = await request.json();
    const admin = db();
    if (input.action === 'create') {
      const requestType = String(input.requestType ?? 'access_request').slice(0, 100);
      const resourceType = String(input.resourceType ?? 'workspace').slice(0, 100);
      const resourceId = input.resourceId ? String(input.resourceId) : null;
      const reason = String(input.reason ?? '').slice(0, 1000);
      const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
      const approver = input.assignedApprover ? String(input.assignedApprover) : null;
      const { data: created, error } = await admin.from('approval_requests').insert({
        request_type: requestType, resource_type: resourceType, resource_id: resourceId,
        requested_by: session.account, assigned_approver: approver, reason, status: 'Pending',
        payload: input.payload ?? {}, expires_at: expiresAt,
      }).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'approval_requested', targetType: 'ApprovalRequest', targetId: created.id, detail: `${requestType} requested for ${resourceType}`, severity: 'info' });
      return NextResponse.json({ request: created }, { status: 201 });
    }
    if (input.action === 'decide') {
      const id = String(input.id ?? '');
      const decision = input.decision === 'Approved' ? 'Approved' : input.decision === 'Cancelled' ? 'Cancelled' : 'Rejected';
      const { data: row } = await admin.from('approval_requests').select('*').eq('id', id).maybeSingle();
      if (!row) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
      if (row.status !== 'Pending') return NextResponse.json({ error: `This request was already ${row.status.toLowerCase()}.` }, { status: 409 });
      const isApprover = row.assigned_approver === session.account
        || hasPermission(session, 'assign_permissions')
        || hasPermission(session, 'revoke_permissions')
        || session.isAdmin;
      if (!isApprover) return NextResponse.json({ error: 'Only an administrator or the assigned approver can decide this request.' }, { status: 403 });

      // The decision and, for an approved access request, the permission itself
      // are written in one transaction. Approving used to change only the
      // request's status, so the staff member stayed blocked while the
      // administrator believed access had been granted.
      const { data: decided, error } = await admin.rpc('decide_approval_request', {
        p_request_id: id,
        p_decision: decision,
        p_actor: /^[0-9a-f-]{36}$/i.test(session.account) ? session.account : null,
        p_actor_name: session.name,
        p_note: String(input.note ?? '').slice(0, 1000),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const result = (decided ?? {}) as { granted?: boolean; permission?: string | null };

      const permission = result.permission ?? null;
      const detail = decision === 'Approved' && result.granted && permission
        ? `Access approved: ${permission.replace(/_/g, ' ')} granted to the requester.`
        : `${decision}: ${String(row.request_type).replace(/_/g, ' ')}${permission ? ` (${permission.replace(/_/g, ' ')})` : ''}.`;
      await recordAudit({ actorId: session.account, actorName: session.name, actorRole: session.role, action: 'approval_decision', targetType: 'ApprovalRequest', targetId: id, detail, severity: decision === 'Approved' ? 'security' : 'change' });

      // Tell the person who asked, in their own notification centre.
      await admin.from('notifications').insert({
        recipient_id: row.requested_by,
        category: 'access',
        priority: decision === 'Approved' ? 'normal' : 'high',
        title: decision === 'Approved'
          ? (result.granted && permission ? `${permission.replace(/_/g, ' ')} approved` : 'Request approved')
          : `Request ${decision.toLowerCase()}`,
        body: decision === 'Approved'
          ? (result.granted && permission
              ? `You can now ${permission.replace(/_/g, ' ')}. Sign out and back in if the workspace does not show it immediately.`
              : `Your request was approved by ${session.name}.`)
          : `Your request was ${decision.toLowerCase()} by ${session.name}.${input.note ? ` Note: ${input.note}` : ''}`,
        link_path: '/',
        related_type: 'approval_request',
        related_id: id,
      }).then(() => undefined, () => undefined);

      return NextResponse.json({
        audit: await getAuditEvents(),
        status: decision,
        granted: result.granted === true,
        permission,
        message: decision === 'Approved'
          ? (result.granted && permission ? `Approved — ${permission.replace(/_/g, ' ')} is now granted.` : 'Approved.')
          : `${decision}.`,
      });
    }
    if (input.action === 'cancel') {
      const id = String(input.id ?? '');
      const { data: row } = await admin.from('approval_requests').select('*').eq('id', id).maybeSingle();
      if (!row) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
      if (row.requested_by !== session.account && !session.isAdmin) return NextResponse.json({ error: 'Only the requester can cancel this request.' }, { status: 403 });
      await admin.from('approval_requests').update({ status: 'Cancelled', decided_at: new Date().toISOString() }).eq('id', id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported approvals action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Approval action failed.' }, { status: 400 });
  }
}
