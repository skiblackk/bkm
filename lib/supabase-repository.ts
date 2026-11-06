import { createSupabaseAdminClient } from './supabase/admin';
import { computeAccountingSnapshot, validateJournalEntry, type ChartAccount } from './accounting';
import { enrichSnapshot, getMetrics } from './repository';
import { searchWorkspaceForAssistant, formatWorkspaceAssistantAnswer, type AssistantData, type AssistantSearchResult } from './assistant-search';
import { getConfiguredDemoDate } from './demo-config';
import { attendanceSettings as defaultAttendanceSettings } from './attendance-data';
import type { DemoSnapshot, InternalMessage, Quotation, ReportRecord, TaskPriority, TaskStatus } from './types';
import type { AccountingSnapshot, AttendanceRecord, DocumentExtraction, JournalEntry, JournalStatus } from './extended-types';
import type { AuditEvent } from './access-control';

/**
 * Production repository: every demonstration-store capability served from the
 * Supabase database. Route code talks to this through `lib/data-access.ts`,
 * so the in-memory demonstration store and this adapter are interchangeable.
 * All reads map rows to the same view-model shapes the workspace renders.
 */

function db() {
  const client = createSupabaseAdminClient();
  if (!client) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for the production repository.');
  return client;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(value: string | null | undefined, fallback = ''): string {
  if (!value) return fallback;
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
function toIsoDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value.replace(/(\d+)(st|nd|rd|th)/, '$1'));
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}
function relative(value: string | null | undefined): string {
  if (!value) return 'Just now';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'Just now';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function clock(value: string | null | undefined): string | null {
  return value ? value.slice(0, 5) : null;
}

interface ProfileRow { id: string; full_name: string; email: string; initials: string; is_admin: boolean; active: boolean; color: string; availability: number; roles: { name: string } | null }
type Row = Record<string, unknown>;
interface SnapshotRows {
  profiles: ProfileRow[]; clients: Row[]; contacts: Row[]; engagements: Row[]; members: Row[];
  tasks: Row[]; documents: Row[]; quotations: Row[]; items: Row[]; reports: Row[]; activities: Row[];
}

let cachedRows: SnapshotRows | null = null;
let cachedAt = 0;
const CACHE_MS = 4000;

async function fetchSnapshotRows(): Promise<SnapshotRows> {
  const client = db();
  const [profiles, clients, contacts, engagements, members, tasks, documents, quotations, items, reports, activities] = await Promise.all([
    client.from('profiles').select('id, full_name, email, initials, is_admin, active, color, availability, roles(name)').eq('active', true).order('created_at', { ascending: true }),
    client.from('clients').select('*').order('created_at', { ascending: true }),
    client.from('client_contacts').select('*'),
    client.from('engagements').select('*').order('created_at', { ascending: true }),
    client.from('engagement_members').select('*'),
    client.from('tasks').select('*').order('created_at', { ascending: true }),
    client.from('documents').select('*').order('uploaded_at', { ascending: true }),
    client.from('quotations').select('*').order('created_at', { ascending: true }),
    client.from('quotation_items').select('*'),
    client.from('reports').select('*').order('created_at', { ascending: true }),
    client.from('activity_logs').select('*').order('created_at', { ascending: false }),
  ]);
  for (const result of [profiles, clients, contacts, engagements, members, tasks, documents, quotations, items, reports, activities]) {
    if (result.error) throw new Error(`Production repository read failed: ${result.error.message}`);
  }
  return {
    profiles: (profiles.data ?? []) as unknown as ProfileRow[],
    clients: clients.data ?? [], contacts: contacts.data ?? [], engagements: engagements.data ?? [], members: members.data ?? [],
    tasks: tasks.data ?? [], documents: documents.data ?? [], quotations: quotations.data ?? [], items: items.data ?? [],
    reports: reports.data ?? [], activities: activities.data ?? [],
  };
}

async function ensureRows(): Promise<SnapshotRows> {
  if (!cachedRows || Date.now() - cachedAt > CACHE_MS) {
    cachedRows = await fetchSnapshotRows();
    cachedAt = Date.now();
  }
  return cachedRows;
}

async function refreshRows(): Promise<SnapshotRows> {
  cachedRows = await fetchSnapshotRows();
  cachedAt = Date.now();
  return cachedRows;
}

function assembleSnapshot(rows: SnapshotRows): DemoSnapshot {
  const engagementClient = new Map<string, string>();
  const engagementTeam = new Map<string, string[]>();
  for (const engagement of rows.engagements) {
    engagementClient.set(String(engagement.id), String(engagement.client_id));
    engagementTeam.set(String(engagement.id), rows.members.filter((member) => member.engagement_id === engagement.id).map((member) => String(member.profile_id)));
  }
  const staff: DemoSnapshot['staff'] = rows.profiles.map((profile) => ({
    id: profile.id,
    name: profile.full_name,
    initials: profile.initials,
    role: Array.isArray(profile.roles) ? profile.roles[0]?.name ?? 'Staff' : (profile.roles as { name?: string } | null)?.name ?? 'Staff',
    email: profile.email,
    activeEngagements: 0, assignedTasks: 0, completedTasks: 0, overdueTasks: 0,
    availability: profile.availability ?? 100,
    color: profile.color ?? '#4e6982',
  }));
  const clients: DemoSnapshot['clients'] = rows.clients.map((client) => {
    const primary = rows.contacts.find((contact) => contact.client_id === client.id && contact.is_primary) ?? rows.contacts.find((contact) => contact.client_id === client.id);
    return {
      id: String(client.id),
      name: String(client.name),
      industry: String(client.industry),
      status: client.status as DemoSnapshot['clients'][number]['status'],
      location: String(client.location),
      contactName: primary ? String(primary.full_name) : '',
      contactEmail: primary ? String(primary.email) : '',
      contactPhone: primary ? String(primary.phone ?? '') : '',
      services: Array.isArray(client.services) ? (client.services as string[]) : ['Audit & Assurance'],
      primaryManagerId: client.primary_manager_id ? String(client.primary_manager_id) : '',
      engagementIds: rows.engagements.filter((engagement) => engagement.client_id === client.id).map((engagement) => String(engagement.id)),
      documentCount: Number(client.document_count ?? 0),
      outstandingRequests: Number(client.outstanding_requests ?? 0),
      lastActivity: String(client.last_activity ?? 'Just now'),
      description: String(client.description ?? ''),
    };
  });
  const engagements: DemoSnapshot['engagements'] = rows.engagements.map((engagement) => ({
    id: String(engagement.id),
    clientId: String(engagement.client_id),
    name: String(engagement.name),
    type: String(engagement.service_type),
    period: String(engagement.period_label),
    status: engagement.status as DemoSnapshot['engagements'][number]['status'],
    managerId: String(engagement.manager_id),
    teamIds: engagementTeam.get(String(engagement.id)) ?? [],
    deadline: fmtDate(String(engagement.deadline), String(engagement.deadline)),
    progress: Number(engagement.progress ?? 0),
    taskIds: [],
    documentCount: Number(engagement.document_count ?? 0),
    outstandingDocuments: Number(engagement.outstanding_documents ?? 0),
    reviewNote: String(engagement.review_note ?? ''),
  }));
  const tasks: DemoSnapshot['tasks'] = rows.tasks.map((task) => ({
    id: String(task.id),
    title: String(task.title),
    description: String(task.description ?? ''),
    clientId: engagementClient.get(String(task.engagement_id)) ?? '',
    engagementId: String(task.engagement_id),
    assignedTo: task.assigned_to ? String(task.assigned_to) : 'unassigned',
    priority: task.priority as TaskPriority,
    dueDate: fmtDate(String(task.due_date), String(task.due_date)),
    status: task.status as TaskStatus,
    updatedAt: fmtDate(String(task.updated_at ?? task.created_at), 'Just now'),
  }));
  const documents: DemoSnapshot['documents'] = rows.documents.map((document) => ({
    id: String(document.id),
    clientId: String(document.client_id),
    engagementId: String(document.engagement_id),
    name: String(document.name),
    type: String(document.document_type),
    status: String(document.status) as DemoSnapshot['documents'][number]['status'],
    uploadedAt: fmtDate(String(document.uploaded_at), 'Just now'),
  }));
  const quotations: Quotation[] = rows.quotations.map((quotation) => ({
    id: String(quotation.id),
    clientId: String(quotation.client_id),
    service: String(quotation.service_type),
    description: String(quotation.description),
    terms: String(quotation.terms),
    items: rows.items.filter((item) => item.quotation_id === quotation.id).map((item) => ({ id: String(item.id), description: String(item.description), quantity: Number(item.quantity), unitPrice: Number(item.unit_price) })),
    status: String(quotation.status) as Quotation['status'],
    createdAt: fmtDate(String(quotation.created_at), 'Just now'),
  }));
  const reports: ReportRecord[] = rows.reports.map((report) => ({
    id: String(report.id),
    clientId: String(report.client_id),
    engagementId: String(report.engagement_id),
    reportType: String(report.report_type),
    status: String(report.status) as ReportRecord['status'],
    createdAt: fmtDate(String(report.created_at), 'Just now'),
  }));
  const activities: DemoSnapshot['activities'] = rows.activities.map((activity) => ({
    id: String(activity.id),
    type: activity.event_type as DemoSnapshot['activities'][number]['type'],
    description: String(activity.description),
    actor: String(activity.actor_name ?? 'BKM Operations Hub'),
    timestamp: relative(String(activity.created_at)),
    recordType: activity.record_type as DemoSnapshot['activities'][number]['recordType'],
    recordId: String(activity.record_id ?? ''),
  }));
  return enrichSnapshot({ staff, clients, engagements, tasks, activities, documents, quotations, reports, environment: 'DEMO ENVIRONMENT' });
}

export async function getSnapshot(): Promise<DemoSnapshot> {
  return assembleSnapshot(await ensureRows());
}

export { getMetrics };

export async function getClient(clientId: string) {
  return (await getSnapshot()).clients.find((client) => client.id === clientId);
}

export async function addStaffMember(member: DemoSnapshot['staff'][number]) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(member.id)) throw new Error('Production staff members must be provisioned with Supabase Auth (use the administrator user controls).');
  const client = db();
  const { data: role } = await client.from('roles').select('id').eq('name', 'Team Member').single();
  const { error } = await client.from('profiles').upsert({ id: member.id, role_id: role?.id, full_name: member.name, email: member.email, initials: member.initials, color: member.color, availability: member.availability, active: true, is_demo: false });
  if (error) throw new Error(error.message);
  await refreshRows();
  return getSnapshot();
}

export async function getAttendance() {
  const client = db();
  const [records, settings] = await Promise.all([
    client.from('attendance_records').select('*').order('attendance_date', { ascending: false }),
    client.from('attendance_settings').select('*').maybeSingle(),
  ]);
  if (records.error) throw new Error(records.error.message);
  return {
    settings: settings.data ? { expectedCheckIn: clock(settings.data.expected_check_in) ?? defaultAttendanceSettings.expectedCheckIn, graceMinutes: settings.data.grace_minutes, workingDays: settings.data.working_days as string[] } : defaultAttendanceSettings,
    records: (records.data ?? []).map((row) => ({ id: String(row.id), staffId: String(row.staff_id), date: String(row.attendance_date), status: row.status as AttendanceRecord['status'], checkIn: clock(row.check_in), checkOut: clock(row.check_out), note: row.note, durationMinutes: row.duration_minutes })) as AttendanceRecord[],
  };
}

export async function updateAttendance(staffId: string, action: 'check-in' | 'check-out', note?: string) {
  const client = db();
  const today = getConfiguredDemoDate();
  const { data: existing } = await client.from('attendance_records').select('*').eq('staff_id', staffId).eq('attendance_date', today).maybeSingle();
  if (action === 'check-in') {
    if (existing?.check_in) throw new Error('Duplicate check-in is not allowed for the same working day.');
    const row = { staff_id: staffId, attendance_date: today, status: 'Late', check_in: '08:10', check_out: null, note: note ?? null, duration_minutes: null };
    const { error } = existing ? await client.from('attendance_records').update(row).eq('id', existing.id) : await client.from('attendance_records').insert(row);
    if (error) throw new Error(error.message);
  } else {
    if (!existing?.check_in) throw new Error('Check in before checking out.');
    if (existing.check_out) throw new Error('This staff member has already checked out today.');
    const { error } = await client.from('attendance_records').update({ check_out: '17:00', duration_minutes: 530 }).eq('id', existing.id);
    if (error) throw new Error(error.message);
  }
  await recordAudit({ actorId: staffId, actorName: staffId, actorRole: 'Team member', action, targetType: 'Attendance', targetId: staffId, detail: `${action} recorded for ${staffId}`, severity: 'info' });
  return getAttendance();
}

export async function listWorkspaceUsers(): Promise<Array<{ account: string; name: string; email: string; role: string; permissions: string[]; isAdmin: boolean; active: boolean; approvalStatus: string; createdAt: string }>> {
  const client = db();
  const { data, error } = await client.from('profiles')
    .select('id, full_name, email, is_admin, active, approval_status, created_at, roles(name), user_permissions!user_id(permission_key)')
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    account: String(row.id),
    name: String(row.full_name),
    email: String(row.email ?? ''),
    role: ((row.roles as { name?: string } | null)?.name) ?? 'Team Member',
    permissions: ((row.user_permissions ?? []) as Array<{ permission_key: string }>).map((p) => p.permission_key),
    isAdmin: Boolean(row.is_admin),
    active: Boolean(row.active),
    approvalStatus: (row.approval_status as string) ?? 'approved',
    createdAt: String(row.created_at ?? ''),
  }));
}

/**
 * Clears every operational record (clients, work, documents, finance entries,
 * messages, attendance, history) while keeping accounts, roles and settings.
 * Used by the administrator "reset workspace" control.
 */
export async function wipeWorkspaceData(): Promise<{ cleared: Record<string, number> }> {
  const client = db();
  const zero = '00000000-0000-0000-0000-000000000000';
  // Children before parents wherever a foreign key exists, then repeat passes so any
  // reference this plan does not know about is cleared on a later sweep instead of
  // blocking the reset.
  const plan: Array<[string, string]> = [
    ['journal_entry_lines', 'journal_entry_id'], ['journal_entries', 'id'], ['accounting_periods', 'id'],
    ['document_extractions', 'id'], ['documents', 'id'], ['task_comments', 'id'], ['tasks', 'id'],
    ['engagement_members', 'engagement_id'], ['reports', 'id'], ['quotation_items', 'id'], ['quotations', 'id'],
    ['engagements', 'id'], ['client_contacts', 'id'], ['clients', 'id'],
    ['activity_logs', 'id'], ['audit_events', 'id'], ['admin_transfers', 'id'], ['attendance_records', 'id'],
    ['internal_messages', 'id'], ['private_messages', 'id'], ['conversation_participants', 'conversation_id'],
    ['conversations', 'id'], ['notifications', 'id'], ['ai_actions', 'id'], ['ai_messages', 'id'],
    ['ai_conversations', 'id'], ['bkm_triage_events', 'id'], ['bkm_triage_drafts', 'id'], ['bkm_triage_cases', 'id'],
    ['user_permissions', 'user_id'],
  ];
  const cleared: Record<string, number> = {};
  const errors: string[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    errors.length = 0;
    let remaining = 0;
    for (const [table, column] of plan) {
      const already = cleared[table] ?? 0;
      const { count, error } = await client.from(table).delete({ count: 'exact' }).neq(column, zero);
      if (error) {
        errors.push(`${table}: ${error.message}`);
        remaining += 1;
        continue;
      }
      cleared[table] = already + (count ?? 0);
      if ((count ?? 0) > 0) remaining += 1;
    }
    if (remaining === 0 && errors.length === 0) return { cleared };
    if (pass === 3) break;
  }
  throw new Error(`Unable to clear: ${errors.join('; ') || 'rows kept reappearing'}`);
}

/** Administrator-controlled account creation (approved immediately). */
export async function provisionUser(input: { name: string; email: string; roleTitle: string; password?: string; isAdmin?: boolean; permissions?: string[] }): Promise<{ userId: string; tempPassword?: string }> {
  const client = db();
  const email = input.email.trim().toLowerCase();
  const tempPassword = input.password ?? `Bkm-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
  const { data: created, error: createError } = await client.auth.admin.createUser({ email, password: tempPassword, email_confirm: true });
  if (createError || !created.user) throw new Error(/already|exists/i.test(createError?.message ?? '') ? 'An account with this email already exists.' : (createError?.message ?? 'Unable to create the user.'));
  const userId = created.user.id;
  const { data: roles } = await client.from('roles').select('id, name').order('name');
  const role = (roles ?? []).find((item) => item.name.toLowerCase() === input.roleTitle.toLowerCase())
    ?? (roles ?? []).find((item) => item.name === (input.isAdmin ? 'System Administrator' : 'Team Member'))
    ?? (roles ?? [])[0];
  if (!role) throw new Error('No role is configured.');
  const initials = input.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  const { error: profileError } = await client.from('profiles').insert({
    id: userId, role_id: role.id, full_name: input.name, email, initials,
    is_admin: Boolean(input.isAdmin), active: true, is_demo: false, approval_status: 'approved', approved_at: new Date().toISOString(),
  });
  if (profileError) throw new Error(`User created, but profile creation failed: ${profileError.message}`);
  const permissions = input.permissions ?? [];
  if (permissions.length) await client.from('user_permissions').insert(permissions.map((permission_key) => ({ user_id: userId, permission_key }))).then(() => undefined, () => undefined);
  return { userId, tempPassword: input.password ? undefined : tempPassword };
}

export async function getInternalMessages(): Promise<InternalMessage[]> {
  const client = db();
  const { data, error } = await client.from('internal_messages').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: String(row.id), senderId: String(row.sender_id), senderName: String(row.sender_name), recipientId: String(row.recipient_id) as string | 'all', recipientName: String(row.recipient_name), body: String(row.body), createdAt: relative(String(row.created_at)), kind: row.kind as InternalMessage['kind'] }));
}

export async function sendInternalMessage(input: { senderId: string; senderName: string; recipientId: string | 'all'; recipientName: string; body: string; kind?: 'direct' | 'broadcast' | 'alert' }) {
  const body = input.body.trim();
  if (!body) throw new Error('Message cannot be empty.');
  const kind = input.kind ?? (input.recipientId === 'all' ? 'broadcast' : 'direct');
  const client = db();
  const { data, error } = await client.from('internal_messages').insert({ sender_id: input.senderId, sender_name: input.senderName, recipient_id: input.recipientId, recipient_name: input.recipientName, body, kind }).select('*').single();
  if (error) throw new Error(error.message);
  await recordAudit({ actorId: input.senderId, actorName: input.senderName, actorRole: input.senderId === 'benjamin' ? 'System Administrator' : 'Team member', action: kind === 'broadcast' ? 'broadcast_message' : 'send_message', targetType: 'Message', targetId: String(data.id), detail: `${kind === 'broadcast' ? 'Broadcast' : 'Direct message'} sent to ${input.recipientName}`, severity: 'info' });
  return { id: String(data.id), senderId: String(data.sender_id), senderName: String(data.sender_name), recipientId: String(data.recipient_id) as string | 'all', recipientName: String(data.recipient_name), body: String(data.body), createdAt: 'Just now', kind } as InternalMessage;
}

export async function removeUser(staffId: string) {
  const client = db();
  const { data: member } = await client.from('profiles').select('id, full_name').eq('id', staffId).maybeSingle();
  if (!member) throw new Error('User was not found.');
  await client.from('profiles').update({ active: false }).eq('id', staffId);
  await client.from('tasks').update({ assigned_to: null }).eq('assigned_to', staffId);
  await client.from('attendance_records').delete().eq('staff_id', staffId);
  await recordAudit({ actorId: 'benjamin', actorName: 'Benjamin Mutua', actorRole: 'System Administrator', action: 'remove_user', targetType: 'User', targetId: staffId, detail: `${member.full_name} was removed and their tasks were unassigned`, severity: 'security' });
  await refreshRows();
  return getSnapshot();
}

export async function assignTask(taskId: string, staffId: string) {
  await recordAudit({ actorId: 'benjamin', actorName: 'Benjamin Mutua', actorRole: 'System Administrator', action: 'assign_task', targetType: 'Task', targetId: taskId, detail: `Task assigned to ${staffId}`, severity: 'change' });
  return updateTask(taskId, { assignedTo: staffId });
}

async function loadAccountingRows() {
  const client = db();
  const [accounts, entries, lines] = await Promise.all([
    client.from('accounting_accounts').select('*').order('code', { ascending: true }),
    client.from('journal_entries').select('*').order('entry_date', { ascending: true }),
    client.from('journal_entry_lines').select('*'),
  ]);
  for (const result of [accounts, entries, lines]) if (result.error) throw new Error(result.error.message);
  const chart: ChartAccount[] = (accounts.data ?? []).map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), type: row.account_type as ChartAccount['type'], balance: 0 }));
  const journal: JournalEntry[] = (entries.data ?? []).map((row) => ({
    id: String(row.id),
    date: String(row.entry_date),
    description: String(row.description),
    reference: String(row.reference),
    status: (row.status ?? 'Posted') as JournalStatus,
    reversedBy: (row.reversed_by as string | null) ?? undefined,
    lines: (lines.data ?? []).filter((line) => line.journal_entry_id === row.id).map((line) => ({ accountId: String(line.account_id), debit: Number(line.debit), credit: Number(line.credit) })),
  }));
  return { chart, journal };
}

export async function getAccounting(options?: { periodStart?: string; periodEnd?: string }): Promise<AccountingSnapshot> {
  const { chart, journal } = await loadAccountingRows();
  return computeAccountingSnapshot(chart, journal, options);
}

export async function addJournalEntry(entry: JournalEntry) {
  const { chart, journal } = await loadAccountingRows();
  validateJournalEntry(entry, journal.map((item) => item.reference), chart);
  const client = db();
  const { data: created, error } = await client.from('journal_entries').insert({ entry_date: entry.date, description: entry.description, reference: entry.reference, status: entry.status ?? 'Posted' }).select('id').single();
  if (error) throw new Error(error.message);
  const lineRows = entry.lines.map((line) => ({ journal_entry_id: created.id, account_id: line.accountId, debit: line.debit, credit: line.credit }));
  const { error: lineError } = await client.from('journal_entry_lines').insert(lineRows);
  if (lineError) throw new Error(lineError.message);
  return getAccounting();
}

export async function reverseJournalEntry(reference: string) {
  const client = db();
  const { data: entry } = await client.from('journal_entries').select('*').eq('reference', reference).maybeSingle();
  if (!entry) throw new Error(`Journal reference ${reference} was not found.`);
  if ((entry.status ?? 'Posted') !== 'Posted') throw new Error('Only posted journal entries can be reversed.');
  const { error } = await client.from('journal_entries').update({ status: 'Reversed' }).eq('id', entry.id);
  if (error) throw new Error(error.message);
  return getAccounting();
}

function extractionFromRow(data: { id: string; filename: string; status: string; summary: string; extracted_json: unknown }): DocumentExtraction {
  return { id: String(data.id), filename: String(data.filename), status: data.status as DocumentExtraction['status'], summary: String(data.summary), ...(data.extracted_json as object) } as DocumentExtraction;
}

export async function getDocumentIntelligence(): Promise<DocumentExtraction> {
  const client = db();
  const { data, error } = await client.from('document_extractions').select('id, filename, status, summary, extracted_json').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { id: 'none', filename: 'No evidence uploaded', status: 'Needs Review', summary: 'No document extractions are recorded yet. Upload client evidence to begin review.', transactions: [], totalDebits: 0, totalCredits: 0, unusualItems: [] };
  return extractionFromRow(data as never);
}

export async function approveDocument() {
  const client = db();
  const { data, error } = await client.from('document_extractions').update({ status: 'Approved', approved_at: new Date().toISOString() }).eq('status', 'Needs Review').select('id, filename, status, summary, extracted_json').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No document extraction is awaiting review.');
  return extractionFromRow(data as never);
}

export async function recordAudit(input: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> {
  const client = db();
  const { data, error } = await client.from('audit_events').insert({ actor_id: input.actorId, actor_name: input.actorName, actor_role: input.actorRole, action: input.action, target_type: input.targetType, target_id: input.targetId, detail: input.detail, severity: input.severity }).select('*').single();
  if (error) throw new Error(error.message);
  return { id: String(data.id), actorId: String(data.actor_id), actorName: String(data.actor_name), actorRole: String(data.actor_role), action: String(data.action), targetType: String(data.target_type), targetId: data.target_id ? String(data.target_id) : undefined, detail: String(data.detail), timestamp: String(data.created_at), severity: data.severity as AuditEvent['severity'] };
}

export async function getAuditEvents(filters?: { actorId?: string; action?: string }): Promise<AuditEvent[]> {
  const client = db();
  let query = client.from('audit_events').select('*').order('created_at', { ascending: false }).limit(200);
  if (filters?.actorId) query = query.eq('actor_id', filters.actorId);
  if (filters?.action) query = query.eq('action', filters.action);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: String(row.id), actorId: String(row.actor_id), actorName: String(row.actor_name), actorRole: String(row.actor_role), action: String(row.action), targetType: String(row.target_type), targetId: row.target_id ? String(row.target_id) : undefined, detail: String(row.detail), timestamp: String(row.created_at), severity: row.severity as AuditEvent['severity'] }));
}

export async function createClient(input: { name: string; industry: string; location: string; contactName: string; contactEmail: string; contactPhone?: string; services?: string[]; description?: string }) {
  const name = input.name.trim();
  if (!name || !input.industry.trim() || !input.location.trim() || !input.contactName.trim() || !input.contactEmail.trim()) throw new Error('Name, industry, location, contact name and contact email are required.');
  const rows = await ensureRows();
  const normalizedName = name.toLowerCase().replace(/\s+/g, ' ');
  const normalizedEmail = input.contactEmail.trim().toLowerCase();
  if (rows.clients.some((client) => String(client.name).toLowerCase().replace(/\s+/g, ' ') === normalizedName)) throw new Error('A client with this name already exists. Open the existing record instead of creating a duplicate.');
  if (rows.contacts.some((contact) => String(contact.email).trim().toLowerCase() === normalizedEmail)) throw new Error('A client contact with this email already exists. Check the existing client record before continuing.');
  const client = db();
  const { data: manager } = await client.from('profiles').select('id').eq('is_admin', false).order('created_at', { ascending: true }).limit(1).maybeSingle();
  const { data: created, error } = await client.from('clients').insert({
    name,
    industry: input.industry.trim(),
    status: 'Active',
    location: input.location.trim(),
    description: input.description?.trim() || 'New client record created in BKM Operations Hub.',
    primary_manager_id: manager?.id ?? null,
    services: input.services?.length ? input.services : ['Audit & Assurance'],
    last_activity: 'Just now',
    document_count: 0,
    outstanding_requests: 0,
  }).select('id').single();
  if (error) throw new Error(error.message);
  const { error: contactError } = await client.from('client_contacts').insert({ client_id: created.id, full_name: input.contactName.trim(), email: input.contactEmail.trim(), phone: input.contactPhone?.trim() || '', is_primary: true });
  if (contactError) throw new Error(contactError.message);
  await client.from('activity_logs').insert({ event_type: 'Client created', description: `${name} was added to the client portfolio`, actor_name: 'Benjamin Mutua', record_type: 'Client', record_id: String(created.id) });
  await recordAudit({ actorId: 'benjamin', actorName: 'Benjamin Mutua', actorRole: 'System Administrator', action: 'create_client', targetType: 'Client', targetId: String(created.id), detail: `Created client ${name}`, severity: 'change' });
  await refreshRows();
  return getSnapshot();
}

export async function updateTask(taskId: string, patch: { status?: TaskStatus; assignedTo?: string }) {
  const client = db();
  const { data: task } = await client.from('tasks').select('id, title').eq('id', taskId).maybeSingle();
  if (!task) return null;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) updates.status = patch.status;
  if (patch.assignedTo) updates.assigned_to = patch.assignedTo === 'unassigned' ? null : patch.assignedTo;
  const { error } = await client.from('tasks').update(updates).eq('id', taskId);
  if (error) throw new Error(error.message);
  await client.from('activity_logs').insert({ event_type: patch.status === 'Completed' ? 'Task completed' : 'Status changed', description: `${task.title} updated in the workspace`, actor_name: 'Workspace user', record_type: 'Task', record_id: taskId });
  await recordAudit({ actorId: 'system', actorName: 'BKM Operations Hub', actorRole: 'System', action: patch.status === 'Completed' ? 'complete_task' : 'update_task', targetType: 'Task', targetId: taskId, detail: `${task.title} changed${patch.assignedTo ? ` and assigned to ${patch.assignedTo}` : ''}`, severity: 'change' });
  await refreshRows();
  return getSnapshot();
}

export async function createTask(input: { title: string; description?: string; clientId?: string; engagementId?: string; assignedTo?: string; priority?: TaskPriority; dueDate?: string }) {
  const snapshot = await getSnapshot();
  const client = input.clientId ? snapshot.clients.find((item) => item.id === input.clientId) : snapshot.clients[0];
  const engagement = input.engagementId ? snapshot.engagements.find((item) => item.id === input.engagementId) : snapshot.engagements.find((item) => item.clientId === client?.id && item.status !== 'Completed');
  if (!client || !engagement) throw new Error('Choose a client and engagement before creating a task.');
  const title = input.title.trim();
  if (!title) throw new Error('A task title is required.');
  const supabase = db();
  const { data: created, error } = await supabase.from('tasks').insert({
    engagement_id: engagement.id,
    title,
    description: input.description?.trim() || 'Created from an instruction to the BKM work assistant.',
    assigned_to: input.assignedTo && input.assignedTo !== 'unassigned' ? input.assignedTo : null,
    priority: input.priority || 'Medium',
    due_date: toIsoDate(input.dueDate, '2026-10-15'),
    status: 'Not Started',
  }).select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('activity_logs').insert({ event_type: 'Task assigned', description: `${title} was created by the BKM work assistant`, actor_name: 'BKM Work Assistant', record_type: 'Task', record_id: String(created.id) });
  await recordAudit({ actorId: 'assistant', actorName: 'BKM Work Assistant', actorRole: 'Assistant', action: 'create_task', targetType: 'Task', targetId: String(created.id), detail: `Created ${title} for ${client.name}`, severity: 'change' });
  await refreshRows();
  return getSnapshot();
}

export async function createQuotation(input: { clientId: string; service: string; description: string; terms: string; items: { id: string; description: string; quantity: number; unitPrice: number }[] }): Promise<DemoSnapshot> {
  const supabase = db();
  const { data: created, error } = await supabase.from('quotations').insert({ client_id: input.clientId, service_type: input.service, description: input.description, terms: input.terms, status: 'Ready for review' }).select('id').single();
  if (error) throw new Error(error.message);
  const items = input.items.map((item) => ({ quotation_id: created.id, description: item.description, quantity: item.quantity, unit_price: item.unitPrice }));
  if (items.length) {
    const { error: itemError } = await supabase.from('quotation_items').insert(items);
    if (itemError) throw new Error(itemError.message);
  }
  await supabase.from('activity_logs').insert({ event_type: 'Status changed', description: 'Quotation prepared for review', actor_name: 'Workspace user', record_type: 'Client', record_id: input.clientId });
  await recordAudit({ actorId: 'system', actorName: 'BKM Operations Hub', actorRole: 'System', action: 'create_quotation', targetType: 'Quotation', targetId: String(created.id), detail: 'A quotation was prepared for review', severity: 'change' });
  await refreshRows();
  return getSnapshot();
}

export async function createReport(input: { clientId: string; engagementId: string; reportType: string }): Promise<{ snapshot: DemoSnapshot; report: ReportRecord }> {
  const supabase = db();
  const { data: created, error } = await supabase.from('reports').insert({ client_id: input.clientId, engagement_id: input.engagementId, report_type: input.reportType, status: 'Draft / Demonstration' }).select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('activity_logs').insert({ event_type: 'Status changed', description: 'Draft report generated', actor_name: 'Workspace user', record_type: 'Engagement', record_id: input.engagementId });
  await recordAudit({ actorId: 'system', actorName: 'BKM Operations Hub', actorRole: 'System', action: 'create_report', targetType: 'Report', targetId: String(created.id), detail: 'A draft report was generated', severity: 'change' });
  await refreshRows();
  const snapshot = await getSnapshot();
  const report = snapshot.reports.find((item) => item.id === String(created.id)) ?? { id: String(created.id), clientId: input.clientId, engagementId: input.engagementId, reportType: input.reportType, status: 'Draft / Demonstration', createdAt: 'Just now' };
  return { snapshot, report };
}

async function assistantData(): Promise<AssistantData> {
  const snapshot = await getSnapshot();
  return { snapshot, attendance: await getAttendance(), accounting: await getAccounting(), demoDate: getConfiguredDemoDate(), metrics: getMetrics(snapshot) };
}

export async function searchForAssistant(question: string): Promise<AssistantSearchResult> {
  return searchWorkspaceForAssistant(question, await assistantData());
}

export async function formatAssistantAnswer(question: string, result: AssistantSearchResult): Promise<string> {
  return formatWorkspaceAssistantAnswer(question, result, await assistantData());
}
