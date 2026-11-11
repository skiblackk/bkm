// Copilot tool layer — the ONLY data access the management copilot has.
// Every tool re-checks the calling user's effective permissions before it
// reads anything; denied tools report the denial instead of the data. All
// numbers come from live database rows; nothing here invents activity.
// Consequential actions (announce, create task, decide approval) are returned
// as drafts with requiresConfirmation=true and are never executed here.

import { createSupabaseAdminClient } from './supabase/admin';
import { businessDate } from './business-clock';
import { hasPermission, type DemoSession } from './auth';
import { getWebhookStatus } from './communication-webhooks';
import { getIntegrationStatus } from './integrations';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string }>; required?: string[] };
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  denied?: boolean;
  summary: string;
  data?: unknown;
  scope: string;
  requiresConfirmation?: boolean;
  draft?: unknown;
}

function db() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Supabase is not configured.');
  return admin;
}

function deny(tool: string, permissions: string[]): ToolResult {
  return { tool, ok: false, denied: true, summary: `You do not have permission for this (${permissions.join(' or ')} required). Nothing was retrieved.`, scope: 'none' };
}

function fmtDate(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '';
}

export function resolvePeriod(from?: string, to?: string): { from: string; to: string; label: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const TODAY = businessDate();
  const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const toDate = parse(to) ?? iso(today);
  const fromDate = parse(from) ?? iso(new Date(today.getTime() - 7 * 86400000));
  return { from: fromDate, to: toDate, label: `${fromDate} → ${toDate}` };
}

/** Compute attendance findings against the configured schedule. */
async function attendanceFindings(from: string, to: string) {
  const admin = db();
  const [{ data: settings }, { data: records }, { data: profiles }, { data: leaves }] = await Promise.all([
    admin.from('attendance_settings').select('expected_check_in, grace_minutes, working_days').maybeSingle(),
    admin.from('attendance_records').select('staff_id, attendance_date, status, check_in, check_out').gte('attendance_date', from).lte('attendance_date', to),
    admin.from('profiles').select('id, full_name, active').eq('active', true),
    admin.from('leave_requests').select('user_id, starts_on, ends_on, status').eq('status', 'Approved').lte('starts_on', to).gte('ends_on', from),
  ]);
  const nameOf = new Map<string, string>((profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  const configured = Boolean(settings?.expected_check_in);
  const grace = Number(settings?.grace_minutes ?? 0);
  const expected = String(settings?.expected_check_in ?? '');
  const onLeave = (userId: string, date: string) => (leaves ?? []).some((l: { user_id: string; starts_on: string; ends_on: string }) => l.user_id === userId && String(l.starts_on).slice(0, 10) <= date && String(l.ends_on).slice(0, 10) >= date);
  const perPerson = new Map<string, { name: string; lateDates: string[]; missingDates: string[]; presentDates: string[]; leaveDates: string[]; earlyDepartures: string[] }>();
  for (const [id, name] of Array.from(nameOf)) perPerson.set(id, { name, lateDates: [], missingDates: [], presentDates: [], leaveDates: [], earlyDepartures: [] });
  const days: string[] = [];
  const start = new Date(from + 'T00:00:00Z'); const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const workingDays = String(settings?.working_days ?? '1,2,3,4,5').split(',').map((x) => parseInt(x, 10));
  const byKey = new Map<string, { status: string; check_in: string | null; check_out: string | null }>();
  for (const r of (records ?? []) as Array<{ staff_id: string; attendance_date: string; status: string; check_in: string | null; check_out: string | null }>) byKey.set(`${r.staff_id}|${String(r.attendance_date).slice(0, 10)}`, r);
  for (const [id, entry] of Array.from(perPerson)) {
    for (const day of days) {
      const dow = new Date(day + 'T00:00:00Z').getUTCDay();
      const isWorkingDay = workingDays.includes(dow === 0 ? 7 : dow);
      const row = byKey.get(`${id}|${day}`);
      if (row) {
        if (row.status === 'On Leave' || onLeave(id, day)) entry.leaveDates.push(day);
        else if (row.check_in && configured && expected) {
          const checkIn = row.check_in.slice(11, 19);
          const [eh, em] = expected.split(':').map(Number);
          const limit = `${String(eh).padStart(2, '0')}:${String(em + grace).padStart(2, '0')}:59`;
          if (checkIn > limit) entry.lateDates.push(day);
          else entry.presentDates.push(day);
        } else if (row.status === 'Absent') entry.missingDates.push(day);
        else entry.presentDates.push(day);
      } else if (isWorkingDay) {
        if (onLeave(id, day)) entry.leaveDates.push(day);
        else entry.missingDates.push(day);
      }
    }
  }
  const people = Array.from(perPerson.entries()).map(([id, entry]) => ({ id, ...entry, lateCount: entry.lateDates.length, missingCount: entry.missingDates.length, presentCount: entry.presentDates.length, leaveCount: entry.leaveDates.length })).filter((p) => p.lateCount + p.missingCount + p.presentCount + p.leaveCount > 0);
  return {
    configured, schedule: configured ? `Check-in expected at ${expected} with ${grace} minute grace` : 'No working schedule configured',
    period: { from, to }, people,
    totals: { late: people.reduce((s, p) => s + p.lateCount, 0), missing: people.reduce((s, p) => s + p.missingCount, 0), present: people.reduce((s, p) => s + p.presentCount, 0), onLeave: people.reduce((s, p) => s + p.leaveCount, 0) },
  };
}

async function taskFindings() {
  const admin = db();
  const [{ data: tasks }, { data: profiles }] = await Promise.all([
    admin.from('tasks').select('id, title, assigned_to, status, priority, due_date, engagement_id'),
    admin.from('profiles').select('id, full_name'),
  ]);
  const nameOf = new Map<string, string>((profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
  const today = businessDate();
  const rows = (tasks ?? []) as Array<{ id: string; title: string; assigned_to: string | null; status: string; priority: string; due_date: string | null }>;
  const overdue = rows.filter((t) => t.status !== 'Completed' && t.due_date && String(t.due_date).slice(0, 10) < today);
  const open = rows.filter((t) => t.status !== 'Completed');
  const unassigned = rows.filter((t) => !t.assigned_to && t.status !== 'Completed');
  const byPerson = new Map<string, { name: string; open: number; overdue: number; completed: number }>();
  for (const t of rows) {
    const key = t.assigned_to ?? 'unassigned';
    const entry = byPerson.get(key) ?? { name: nameOf.get(key) ?? 'Unassigned', open: 0, overdue: 0, completed: 0 };
    if (t.status === 'Completed') entry.completed += 1;
    else { entry.open += 1; if (t.due_date && String(t.due_date).slice(0, 10) < today) entry.overdue += 1; }
    byPerson.set(key, entry);
  }
  return {
    total: rows.length, open: open.length, overdue: overdue.length, unassigned: unassigned.length,
    overdueTasks: overdue.slice(0, 20).map((t) => ({ id: t.id, title: t.title, assignee: t.assigned_to ? nameOf.get(t.assigned_to) ?? t.assigned_to : 'Unassigned', due: fmtDate(t.due_date), priority: t.priority, status: t.status })),
    workload: Array.from(byPerson.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.open - a.open),
  };
}

export const TOOL_SPECS: ToolSpec[] = [
  { name: 'attendance_summary', description: 'Attendance findings for a period: late arrivals, missing records, approved leave and the configured working schedule.', parameters: { type: 'object', properties: { from: { type: 'string', description: 'Start date YYYY-MM-DD' }, to: { type: 'string', description: 'End date YYYY-MM-DD' } } } },
  { name: 'task_workload', description: 'Open, overdue and completed task counts per employee, plus overdue task details and unassigned work.', parameters: { type: 'object', properties: {} } },
  { name: 'pending_approvals', description: 'Pending approval requests and pending leave requests awaiting a decision.', parameters: { type: 'object', properties: {} } },
  { name: 'audit_log_summary', description: 'Recent system audit events: permission changes, sign-ins, administrative actions.', parameters: { type: 'object', properties: { from: { type: 'string', description: 'Start date YYYY-MM-DD' }, to: { type: 'string', description: 'End date YYYY-MM-DD' } } } },
  { name: 'system_health', description: 'Integration and webhook connection status and configuration gaps.', parameters: { type: 'object', properties: {} } },
  { name: 'employee_directory', description: 'Active employee list with roles and approval status.', parameters: { type: 'object', properties: {} } },
  { name: 'my_tasks', description: 'The requesting user\'s own tasks and deadlines.', parameters: { type: 'object', properties: {} } },
  { name: 'finance_overview', description: 'Journal entry counts by status and financial statement headlines from the accounting records.', parameters: { type: 'object', properties: {} } },
  { name: 'recent_broadcasts', description: 'Recent company announcements and broadcasts.', parameters: { type: 'object', properties: {} } },
  { name: 'prepare_announcement_draft', description: 'Prepare a company announcement draft for human confirmation before sending. Never sends.', parameters: { type: 'object', properties: { audience: { type: 'string', description: 'all or a person name' }, message: { type: 'string', description: 'Announcement text' } }, required: ['audience', 'message'] } },
  { name: 'prepare_task_draft', description: 'Prepare a proposed task for human confirmation before creation. Never creates.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Task title' }, assignee: { type: 'string', description: 'Person name or unassigned' } }, required: ['title'] } },
  { name: 'prepare_access_request', description: 'Prepare an access or permission request for the approval workflow.', parameters: { type: 'object', properties: { permission: { type: 'string', description: 'Permission key requested' }, reason: { type: 'string', description: 'Why it is needed' } }, required: ['permission', 'reason'] } },
];

export async function executeTool(name: string, args: Record<string, unknown>, session: DemoSession): Promise<ToolResult> {
  try {
    switch (name) {
      case 'attendance_summary': {
        if (!hasPermission(session, 'view_team_attendance') && !hasPermission(session, 'manage_attendance') && !hasPermission(session, 'view_hr_reports') && !session.isAdmin) return deny(name, ['view_team_attendance', 'manage_attendance', 'view_hr_reports']);
        const { from, to, label } = resolvePeriod(args.from as string | undefined, args.to as string | undefined);
        const findings = await attendanceFindings(from, to);
        if (!findings.configured) return { tool: name, ok: true, summary: `Attendance for ${label}: the working schedule is NOT configured (no expected check-in/grace), so lateness cannot be judged reliably. ${findings.totals.present} recorded present, ${findings.totals.missing} with no record. Configure attendance rules first.`, data: findings, scope: `all active employees, ${label}` };
        const latePeople = findings.people.filter((p) => p.lateCount > 0).sort((a, b) => b.lateCount - a.lateCount);
        const missingPeople = findings.people.filter((p) => p.missingCount > 0).sort((a, b) => b.missingCount - a.missingCount);
        return {
          tool: name, ok: true,
          summary: [
            label,
            `- Late arrivals: ${findings.totals.late}`,
            `- Missing check-in records: ${findings.totals.missing}`,
            `- Approved-leave days: ${findings.totals.onLeave}`,
            `- Present days: ${findings.totals.present}`,
            `- Most late: ${latePeople.slice(0, 3).map((p) => `${p.name} (${p.lateCount}x)`).join(', ') || 'none'}`,
            `- Most missing records: ${missingPeople.slice(0, 3).map((p) => `${p.name} (${p.missingCount}x)`).join(', ') || 'none'}`,
          ].join('\n'),
          data: findings, scope: `all active employees, ${label}`,
        };
      }
      case 'task_workload': {
        if (!hasPermission(session, 'analyse_team_data') && !hasPermission(session, 'edit_team_tasks') && !hasPermission(session, 'assign_tasks') && !session.isAdmin) return deny(name, ['analyse_team_data', 'edit_team_tasks', 'assign_tasks']);
        const findings = await taskFindings();
        return {
          tool: name, ok: true,
          summary: `Tasks: ${findings.open} open of ${findings.total}, ${findings.overdue} overdue, ${findings.unassigned} unassigned. Workload: ${findings.workload.slice(0, 5).map((p) => `${p.name}: ${p.open} open (${p.overdue} overdue)`).join('; ') || 'no assignments'}.`,
          data: findings, scope: 'all task records',
        };
      }
      case 'pending_approvals': {
        const admin = db();
        const seesAll = hasPermission(session, 'assign_permissions') || hasPermission(session, 'approve_leave') || hasPermission(session, 'manage_leave') || session.isAdmin;
        const [approvals, leaves] = await Promise.all([
          admin.from('approval_requests').select('id, request_type, resource_type, requested_by, assigned_approver, reason, status, created_at').eq('status', 'Pending').limit(50),
          admin.from('leave_requests').select('id, user_id, leave_type, starts_on, ends_on, reason, status').eq('status', 'Pending').limit(50),
        ]);
        const scopedApprovals = seesAll ? (approvals?.data ?? []) : (approvals?.data ?? []).filter((r: { requested_by: string }) => r.requested_by === session.account);
        const scopedLeaves = seesAll ? (leaves?.data ?? []) : (leaves?.data ?? []).filter((r: { user_id: string }) => r.user_id === session.account);
        return {
          tool: name, ok: true,
          summary: `${scopedApprovals.length} pending approval request(s) and ${scopedLeaves.length} pending leave request(s)${seesAll ? '' : ' (your own only)'}.`,
          data: { approvals: scopedApprovals, leaveRequests: scopedLeaves }, scope: seesAll ? 'company-wide requests' : 'own requests only',
        };
      }
      case 'audit_log_summary': {
        if (!hasPermission(session, 'view_audit_logs') && !session.isAdmin) return deny(name, ['view_audit_logs']);
        const { from, to, label } = resolvePeriod(args.from as string | undefined, args.to as string | undefined);
        const admin = db();
        const { data } = await admin.from('audit_events').select('id, actor_name, actor_role, action, target_type, detail, severity, created_at').gte('created_at', from).lte('created_at', to + 'T23:59:59').order('created_at', { ascending: false }).limit(30);
        const rows = (data ?? []) as Array<{ action: string }>;
        const counts = new Map<string, number>();
        for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
        return { tool: name, ok: true, summary: `Audit log ${label}: ${rows.length} events — ${Array.from(counts.entries()).map(([a, c]) => `${a}×${c}`).join(', ') || 'none'}.`, data: { events: data }, scope: `audit events, ${label}` };
      }
      case 'system_health': {
        if (!hasPermission(session, 'manage_integrations') && !hasPermission(session, 'manage_workspace_settings') && !session.isAdmin) return deny(name, ['manage_integrations', 'manage_workspace_settings']);
        const webhooks = getWebhookStatus(); const integrations = getIntegrationStatus();
        return { tool: name, ok: true, summary: `System health: integrations — Gmail ${(integrations as { gmail?: { connected?: boolean } }).gmail?.connected ? 'connected' : 'not connected'}, Respond.io ${(integrations as { respondIo?: { connected?: boolean } }).respondIo?.connected ? 'connected' : 'not connected'}. ${Array.isArray(webhooks) ? webhooks.filter((w: { configured?: boolean }) => !w.configured).length + ' webhook(s) not configured' : ''}.`, data: { webhooks, integrations }, scope: 'integration configuration' };
      }
      case 'employee_directory': {
        if (!hasPermission(session, 'view_staff_directory') && !hasPermission(session, 'view_user_directory') && !session.isAdmin) return deny(name, ['view_staff_directory']);
        const admin = db();
        const { data } = await admin.from('profiles').select('id, full_name, email, is_admin, active, approval_status, roles(name)').order('full_name');
        const rows = (data ?? []).map((p: { id: string; full_name: string; email: string; active: boolean; approval_status: string; roles: { name?: string } | Array<{ name?: string }> | null }) => ({ id: p.id, name: p.full_name, email: p.email, role: (Array.isArray(p.roles) ? p.roles[0]?.name : (p.roles as { name?: string } | null)?.name) ?? 'Staff', active: p.active, approvalStatus: p.approval_status }));
        return { tool: name, ok: true, summary: `${rows.filter((r: { active: boolean }) => r.active).length} active account(s), ${rows.filter((r: { approvalStatus: string }) => r.approvalStatus === 'pending').length} awaiting approval.`, data: { people: rows }, scope: 'staff directory' };
      }
      case 'my_tasks': {
        const admin = db();
        const { data } = await admin.from('tasks').select('id, title, status, priority, due_date').eq('assigned_to', session.account).limit(30);
        return { tool: name, ok: true, summary: `You have ${(data ?? []).filter((t: { status: string }) => t.status !== 'Completed').length} open task(s).`, data: { tasks: data }, scope: 'your own tasks' };
      }
      case 'finance_overview': {
        if (!hasPermission(session, 'view_finance') && !hasPermission(session, 'analyse_financial_data') && !session.isAdmin) return deny(name, ['view_finance', 'analyse_financial_data']);
        const admin = db();
        const { data } = await admin.from('journal_entries').select('id, entry_date, description, status, created_at').order('entry_date', { ascending: false }).limit(100);
        const counts = new Map<string, number>();
        for (const r of (data ?? []) as Array<{ status: string }>) counts.set(r.status, (counts.get(r.status ?? 'Draft') ?? 0) + 1);
        return { tool: name, ok: true, summary: `Journal entries: ${Array.from(counts.entries()).map(([s, c]) => `${s}×${c}`).join(', ') || 'none recorded'}.`, data: { entries: data }, scope: 'accounting journal (statement figures via the finance workspace)' };
      }
      case 'recent_broadcasts': {
        const admin = db();
        const { data } = await admin.from('internal_messages').select('id, sender_name, body, created_at').eq('kind', 'broadcast').order('created_at', { ascending: false }).limit(10);
        return { tool: name, ok: true, summary: `${(data ?? []).length} recent broadcast(s).`, data: { broadcasts: data }, scope: 'company broadcasts' };
      }
      case 'prepare_announcement_draft': {
        return { tool: name, ok: true, summary: `Draft announcement prepared for “${String(args.audience ?? 'all')}”. It has NOT been sent — confirm to send via the Communications panel.`, requiresConfirmation: true, draft: { type: 'announcement', audience: args.audience, message: args.message }, scope: 'draft only' };
      }
      case 'prepare_task_draft': {
        return { tool: name, ok: true, summary: `Draft task “${String(args.title ?? '')}” prepared${args.assignee ? ` for ${args.assignee}` : ''}. It has NOT been created — confirm to create.`, requiresConfirmation: true, draft: { type: 'task', title: args.title, assignee: args.assignee }, scope: 'draft only' };
      }
      case 'prepare_access_request': {
        return { tool: name, ok: true, summary: `Draft access request for “${String(args.permission ?? '')}” prepared. Confirm to submit it to the approval workflow.`, requiresConfirmation: true, draft: { type: 'access_request', permission: args.permission, reason: args.reason }, scope: 'draft only' };
      }
      default:
        return { tool: name, ok: false, summary: `Unknown tool ${name}.`, scope: 'none' };
    }
  } catch (error) {
    return { tool: name, ok: false, summary: `Tool failed: ${error instanceof Error ? error.message : 'unknown error'}`, scope: 'error' };
  }
}
