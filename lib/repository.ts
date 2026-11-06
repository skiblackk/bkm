import { cloneSeedSnapshot } from './demo-data';
import type { DashboardMetrics, DemoSnapshot, InternalMessage, Quotation, QuotationItem, ReportRecord, TaskPriority, TaskStatus } from './types';
import { attendanceSeed, attendanceSettings } from './attendance-data';
import type { AttendanceRecord, AccountingSnapshot, DocumentExtraction } from './extended-types';
import { addJournalEntry as postJournalEntry, getAccountingSnapshot, reverseJournalEntry as reversePostedJournal } from './accounting';
import { approveDocumentExtraction, getDocumentExtraction } from './document-intelligence';
import type { AuditEvent, PermissionId, UserRole } from './access-control';
import { getConfiguredDemoDate } from './demo-config';
import { isBeforeToday, isWithinNextDays } from './date-label';
import { searchWorkspaceForAssistant, formatWorkspaceAssistantAnswer, type AssistantData } from './assistant-search';

declare global {
  var __bkmInternalMessages: InternalMessage[] | undefined;
}

let snapshot: DemoSnapshot | undefined;
let attendance: AttendanceRecord[] = JSON.parse(JSON.stringify(attendanceSeed)) as AttendanceRecord[];
const internalMessages = globalThis.__bkmInternalMessages ?? (globalThis.__bkmInternalMessages = [
  { id: 'msg-001', senderId: 'benjamin', senderName: 'Benjamin Mutua', recipientId: 'all', recipientName: 'All users', body: 'Please check in before starting client work today.', createdAt: '08:00', kind: 'broadcast' },
  { id: 'msg-002', senderId: 'staff-david', senderName: 'David Kamau', recipientId: 'benjamin', recipientName: 'Benjamin Mutua', body: 'The ABC Manufacturing review pack is ready for your review.', createdAt: '08:15', kind: 'direct' },
]);
let auditEvents: AuditEvent[] = [];

export function recordAudit(input: Omit<AuditEvent, 'id' | 'timestamp'>) { const event: AuditEvent = { ...input, id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: new Date().toISOString() }; auditEvents.unshift(event); return event; }
export function getAuditEvents(filters?: { actorId?: string; action?: string }) { return auditEvents.filter((event) => (!filters?.actorId || event.actorId === filters.actorId) && (!filters?.action || event.action === filters.action)).slice(0, 200); }

function getStore(): DemoSnapshot {
  if (!snapshot) snapshot = cloneSeedSnapshot();
  return snapshot;
}


export function enrichSnapshot(store: DemoSnapshot): DemoSnapshot {
  const copy = JSON.parse(JSON.stringify(store)) as DemoSnapshot;
  copy.engagements = copy.engagements.map((engagement) => ({
    ...engagement,
    taskIds: copy.tasks.filter((task) => task.engagementId === engagement.id).map((task) => task.id),
  }));
  copy.staff = copy.staff.map((member) => {
    const owned = copy.tasks.filter((task) => task.assignedTo === member.id);
    return {
      ...member,
      assignedTasks: owned.length,
      completedTasks: owned.filter((task) => task.status === 'Completed').length,
      overdueTasks: owned.filter((task) => task.status !== 'Completed' && isBeforeToday(task.dueDate)).length,
      activeEngagements: copy.engagements.filter((engagement) => engagement.status !== 'Completed' && (engagement.managerId === member.id || engagement.teamIds.includes(member.id))).length,
    };
  });
  return copy;
}

export function getSnapshot(): DemoSnapshot {
  return enrichSnapshot(getStore());
}

export function addStaffMember(member: DemoSnapshot['staff'][number]) {
  const store = getStore();
  if (!store.staff.some((item) => item.id === member.id)) store.staff.push(member);
  return getSnapshot();
}

export function getAttendance() {
  return { settings: attendanceSettings, records: JSON.parse(JSON.stringify(attendance)) as AttendanceRecord[] };
}

export function updateAttendance(staffId: string, action: 'check-in' | 'check-out', note?: string) {
  const today = getConfiguredDemoDate();
  let record = attendance.find((item) => item.staffId === staffId && item.date === today);
  if (!record) {
    record = { id: `att-${Date.now()}`, staffId, date: today, status: 'Not Checked In', checkIn: null, checkOut: null, note: null, durationMinutes: null };
    attendance.push(record);
  }
  if (action === 'check-in') {
    if (record.checkIn) throw new Error('Duplicate check-in is not allowed for the same working day.');
    record.checkIn = '08:10';
    record.status = 'Late';
    record.note = note ?? null;
  } else {
    if (!record.checkIn) throw new Error('Check in before checking out.');
    if (record.checkOut) throw new Error('This staff member has already checked out today.');
    record.checkOut = '17:00';
    record.durationMinutes = 530;
  }
  recordAudit({ actorId: staffId, actorName: staffId, actorRole: 'Team member', action, targetType: 'Attendance', targetId: staffId, detail: `${action} recorded for ${staffId}`, severity: 'info' });
  return getAttendance();
}

export function getInternalMessages() { return JSON.parse(JSON.stringify(internalMessages)) as InternalMessage[]; }
export function sendInternalMessage(input: { senderId: string; senderName: string; recipientId: string | 'all'; recipientName: string; body: string; kind?: 'direct' | 'broadcast' | 'alert' }) {
  const message: InternalMessage = { id: `msg-${Date.now()}`, senderId: input.senderId, senderName: input.senderName, recipientId: input.recipientId, recipientName: input.recipientName, body: input.body.trim(), createdAt: 'Just now', kind: input.kind ?? (input.recipientId === 'all' ? 'broadcast' : 'direct') };
  if (!message.body) throw new Error('Message cannot be empty.');
  internalMessages.unshift(message);
  recordAudit({ actorId: input.senderId, actorName: input.senderName, actorRole: input.senderId === 'benjamin' ? 'System Administrator' : 'Team member', action: message.kind === 'broadcast' ? 'broadcast_message' : 'send_message', targetType: 'Message', targetId: message.id, detail: `${message.kind === 'broadcast' ? 'Broadcast' : 'Direct message'} sent to ${message.recipientName}`, severity: 'info' });
  return message;
}
export function removeUser(staffId: string) {
  const store = getStore();
  const member = store.staff.find((item) => item.id === staffId);
  if (!member) throw new Error('User was not found.');
  store.staff = store.staff.filter((item) => item.id !== staffId);
  store.tasks = store.tasks.map((task) => task.assignedTo === staffId ? { ...task, assignedTo: 'unassigned', updatedAt: getConfiguredDemoDate() } : task);
  attendance = attendance.filter((record) => record.staffId !== staffId);
  store.activities.unshift({ id: `activity-${Date.now()}`, type: 'Status changed', description: `${member.name} was removed from the demonstration workspace`, actor: 'Benjamin Mutua', timestamp: 'Just now', recordType: 'Task', recordId: staffId });
  recordAudit({ actorId: 'benjamin', actorName: 'Benjamin Mutua', actorRole: 'System Administrator', action: 'remove_user', targetType: 'User', targetId: staffId, detail: `${member.name} was removed and their tasks were unassigned`, severity: 'security' });
  return getSnapshot();
}
export function assignTask(taskId: string, staffId: string) { recordAudit({ actorId: 'benjamin', actorName: 'Benjamin Mutua', actorRole: 'System Administrator', action: 'assign_task', targetType: 'Task', targetId: taskId, detail: `Task assigned to ${staffId}`, severity: 'change' }); return updateTask(taskId, { assignedTo: staffId }); }
export function getAccounting(options?: { periodStart?: string; periodEnd?: string }): AccountingSnapshot { return getAccountingSnapshot(options); }
export function addJournalEntry(entry: Parameters<typeof postJournalEntry>[0]) { return postJournalEntry(entry); }
export function reverseJournalEntry(reference: string) { return reversePostedJournal(reference); }
export function getDocumentIntelligence(): DocumentExtraction { return getDocumentExtraction(); }
export function approveDocument() { return approveDocumentExtraction(); }

export function getMetrics(store = getSnapshot()): DashboardMetrics {
  return {
    activeClients: store.clients.filter((client) => client.status === 'Active').length,
    activeEngagements: store.engagements.filter((engagement) => engagement.status !== 'Completed').length,
    pendingTasks: store.tasks.filter((task) => task.status !== 'Completed').length,
    overdueTasks: store.tasks.filter((task) => task.status !== 'Completed' && isBeforeToday(task.dueDate)).length,
    upcomingDeadlines: store.engagements.filter((engagement) => engagement.status !== 'Completed' && isWithinNextDays(engagement.deadline, 14)).length,
    pendingReviews: store.engagements.filter((engagement) => engagement.status === 'Under Review' || store.tasks.some((task) => task.engagementId === engagement.id && task.status === 'Under Review')).length,
  };
}

export function getClient(clientId: string) {
  const store = getSnapshot();
  return store.clients.find((client) => client.id === clientId);
}

export function createClient(input: { name: string; industry: string; location: string; contactName: string; contactEmail: string; contactPhone?: string; services?: string[]; description?: string }) {
  const store = getStore();
  const name = input.name.trim();
  if (!name || !input.industry.trim() || !input.location.trim() || !input.contactName.trim() || !input.contactEmail.trim()) throw new Error('Name, industry, location, contact name and contact email are required.');
  const normalizedName = name.toLowerCase().replace(/\s+/g, ' ');
  const normalizedEmail = input.contactEmail.trim().toLowerCase();
  if (store.clients.some((client) => client.name.toLowerCase().replace(/\s+/g, ' ') === normalizedName)) throw new Error('A client with this name already exists. Open the existing record instead of creating a duplicate.');
  if (store.clients.some((client) => client.contactEmail.trim().toLowerCase() === normalizedEmail)) throw new Error('A client contact with this email already exists. Check the existing client record before continuing.');
  const client = { id: `client-${Date.now()}`, name, industry: input.industry.trim(), status: 'Active' as const, location: input.location.trim(), contactName: input.contactName.trim(), contactEmail: input.contactEmail.trim(), contactPhone: input.contactPhone?.trim() || '', services: input.services?.length ? input.services : ['Audit & Assurance'], primaryManagerId: 'staff-david', engagementIds: [], documentCount: 0, outstandingRequests: 0, lastActivity: 'Just now', description: input.description?.trim() || 'New client record created in BKM Operations Hub.' };
  store.clients.unshift(client);
  store.activities.unshift({ id: `activity-${Date.now()}-client`, type: 'Client created', description: `${client.name} was added to the client portfolio`, actor: 'Benjamin Mutua', timestamp: 'Just now', recordType: 'Client', recordId: client.id });
  recordAudit({ actorId: 'benjamin', actorName: 'Benjamin Mutua', actorRole: 'System Administrator', action: 'create_client', targetType: 'Client', targetId: client.id, detail: `Created client ${client.name}`, severity: 'change' });
  return getSnapshot();
}

export function updateTask(taskId: string, patch: { status?: TaskStatus; assignedTo?: string }) {
  const store = getStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  if (patch.status) task.status = patch.status;
  if (patch.assignedTo) task.assignedTo = patch.assignedTo;
  task.updatedAt = getConfiguredDemoDate();
  store.activities.unshift({ id: `activity-${Date.now()}`, type: patch.status === 'Completed' ? 'Task completed' : 'Status changed', description: `${task.title} updated in the demonstration environment`, actor: 'Demo Manager', timestamp: 'Just now', recordType: 'Task', recordId: task.id });
  recordAudit({ actorId: 'system', actorName: 'BKM Operations Hub', actorRole: 'System', action: patch.status === 'Completed' ? 'complete_task' : 'update_task', targetType: 'Task', targetId: task.id, detail: `${task.title} changed${patch.assignedTo ? ` and assigned to ${patch.assignedTo}` : ''}`, severity: 'change' });
  return getSnapshot();
}

export function createTask(input: { title: string; description?: string; clientId?: string; engagementId?: string; assignedTo?: string; priority?: TaskPriority; dueDate?: string }) {
  const store = getStore();
  const client = input.clientId ? store.clients.find((item) => item.id === input.clientId) : store.clients[0];
  const engagement = input.engagementId ? store.engagements.find((item) => item.id === input.engagementId) : store.engagements.find((item) => item.clientId === client?.id && item.status !== 'Completed');
  if (!client || !engagement) throw new Error('Choose a client and engagement before creating a task.');
  const task = { id: `task-${Date.now()}`, title: input.title.trim(), description: input.description?.trim() || 'Created from an instruction to the BKM work assistant.', clientId: client.id, engagementId: engagement.id, assignedTo: input.assignedTo || 'unassigned', priority: input.priority || 'Medium', dueDate: input.dueDate || '15 Oct 2026', status: 'Not Started' as const, updatedAt: getConfiguredDemoDate() };
  if (!task.title) throw new Error('A task title is required.');
  store.tasks.unshift(task);
  store.activities.unshift({ id: `activity-${Date.now()}-task`, type: 'Task assigned', description: `${task.title} was created by the BKM work assistant`, actor: 'BKM Work Assistant', timestamp: 'Just now', recordType: 'Task', recordId: task.id });
  recordAudit({ actorId: 'assistant', actorName: 'BKM Work Assistant', actorRole: 'Assistant', action: 'create_task', targetType: 'Task', targetId: task.id, detail: `Created ${task.title} for ${client.name}`, severity: 'change' });
  return getSnapshot();
}

export function createQuotation(input: { clientId: string; service: string; description: string; terms: string; items: QuotationItem[] }): DemoSnapshot {
  const store = getStore();
  const quotation: Quotation = { id: `quote-${Date.now()}`, ...input, status: 'Ready for review', createdAt: getConfiguredDemoDate() };
  store.quotations.unshift(quotation);
  store.activities.unshift({ id: `activity-${Date.now()}-quote`, type: 'Status changed', description: 'Demonstration quotation prepared for review', actor: 'Demo Manager', timestamp: 'Just now', recordType: 'Client', recordId: input.clientId });
  recordAudit({ actorId: 'system', actorName: 'BKM Operations Hub', actorRole: 'System', action: 'create_quotation', targetType: 'Quotation', targetId: quotation.id, detail: 'A quotation was prepared for review', severity: 'change' });
  return getSnapshot();
}

export function createReport(input: { clientId: string; engagementId: string; reportType: string }): { snapshot: DemoSnapshot; report: ReportRecord } {
  const store = getStore();
  const report: ReportRecord = { id: `report-${Date.now()}`, ...input, status: 'Draft / Demonstration', createdAt: getConfiguredDemoDate() };
  store.reports.unshift(report);
  store.activities.unshift({ id: `activity-${Date.now()}-report`, type: 'Status changed', description: 'Draft demonstration report generated', actor: 'Demo Manager', timestamp: 'Just now', recordType: 'Engagement', recordId: input.engagementId });
  recordAudit({ actorId: 'system', actorName: 'BKM Operations Hub', actorRole: 'System', action: 'create_report', targetType: 'Report', targetId: report.id, detail: 'A draft report was generated', severity: 'change' });
  return { snapshot: getSnapshot(), report };
}

export function searchForAssistant(question: string) {
  return searchWorkspaceForAssistant(question, assistantData());
}

export function formatAssistantAnswer(question: string, result: ReturnType<typeof searchForAssistant>) {
  return formatWorkspaceAssistantAnswer(question, result, assistantData());
}

function assistantData(): AssistantData {
  const snapshot = getSnapshot();
  return { snapshot, attendance: getAttendance(), accounting: getAccounting(), demoDate: getConfiguredDemoDate(), metrics: getMetrics(snapshot) };
}
