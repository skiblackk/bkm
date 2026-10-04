import { cloneSeedSnapshot } from './demo-data';
import type { DashboardMetrics, DemoSnapshot, InternalMessage, Quotation, QuotationItem, ReportRecord, TaskStatus } from './types';
import { attendanceSeed, attendanceSettings } from './attendance-data';
import type { AttendanceRecord, AccountingSnapshot, DocumentExtraction } from './extended-types';
import { getAccountingSnapshot } from './accounting';
import { approveDocumentExtraction, getDocumentExtraction } from './document-intelligence';

let snapshot: DemoSnapshot | undefined;
let attendance: AttendanceRecord[] = JSON.parse(JSON.stringify(attendanceSeed)) as AttendanceRecord[];
let internalMessages: InternalMessage[] = [
  { id: 'msg-001', senderId: 'admin', senderName: 'BKM Administrator', recipientId: 'all', recipientName: 'All users', body: 'Please check in before starting client work today.', createdAt: '08:00', kind: 'broadcast' },
  { id: 'msg-002', senderId: 'staff-david', senderName: 'David Kamau', recipientId: 'admin', recipientName: 'BKM Administrator', body: 'The ABC Manufacturing review pack is ready for your review.', createdAt: '08:15', kind: 'direct' },
];

function getStore(): DemoSnapshot {
  if (!snapshot) snapshot = cloneSeedSnapshot();
  return snapshot;
}

function isBeforeToday(dateLabel: string) {
  const date = new Date(dateLabel.replace(/(\d+)(st|nd|rd|th)/, '$1'));
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < new Date('2026-10-01T00:00:00Z').getTime();
}

function enrich(store: DemoSnapshot): DemoSnapshot {
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
  return enrich(getStore());
}

export function getAttendance() {
  return { settings: attendanceSettings, records: JSON.parse(JSON.stringify(attendance)) as AttendanceRecord[] };
}

export function updateAttendance(staffId: string, action: 'check-in' | 'check-out', note?: string) {
  const today = '2026-10-01';
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
  return getAttendance();
}

export function getInternalMessages() { return JSON.parse(JSON.stringify(internalMessages)) as InternalMessage[]; }
export function sendInternalMessage(input: { senderId: string; senderName: string; recipientId: string | 'all'; recipientName: string; body: string; kind?: 'direct' | 'broadcast' | 'alert' }) {
  const message: InternalMessage = { id: `msg-${Date.now()}`, senderId: input.senderId, senderName: input.senderName, recipientId: input.recipientId, recipientName: input.recipientName, body: input.body.trim(), createdAt: 'Just now', kind: input.kind ?? (input.recipientId === 'all' ? 'broadcast' : 'direct') };
  if (!message.body) throw new Error('Message cannot be empty.');
  internalMessages.unshift(message);
  return message;
}
export function removeUser(staffId: string) {
  const store = getStore();
  const member = store.staff.find((item) => item.id === staffId);
  if (!member) throw new Error('User was not found.');
  store.staff = store.staff.filter((item) => item.id !== staffId);
  store.tasks = store.tasks.map((task) => task.assignedTo === staffId ? { ...task, assignedTo: 'unassigned', updatedAt: '01 Oct 2026' } : task);
  attendance = attendance.filter((record) => record.staffId !== staffId);
  store.activities.unshift({ id: `activity-${Date.now()}`, type: 'Status changed', description: `${member.name} was removed from the demonstration workspace`, actor: 'BKM Administrator', timestamp: 'Just now', recordType: 'Task', recordId: staffId });
  return getSnapshot();
}
export function assignTask(taskId: string, staffId: string) { return updateTask(taskId, { assignedTo: staffId }); }
export function getAccounting(): AccountingSnapshot { return getAccountingSnapshot(); }
export function getDocumentIntelligence(): DocumentExtraction { return getDocumentExtraction(); }
export function approveDocument() { return approveDocumentExtraction(); }

export function getMetrics(store = getSnapshot()): DashboardMetrics {
  return {
    activeClients: store.clients.filter((client) => client.status === 'Active').length,
    activeEngagements: store.engagements.filter((engagement) => engagement.status !== 'Completed').length,
    pendingTasks: store.tasks.filter((task) => task.status !== 'Completed').length,
    overdueTasks: store.tasks.filter((task) => task.status !== 'Completed' && isBeforeToday(task.dueDate)).length,
    upcomingDeadlines: store.engagements.filter((engagement) => engagement.status !== 'Completed').length,
    pendingReviews: store.engagements.filter((engagement) => engagement.status === 'Under Review' || store.tasks.some((task) => task.engagementId === engagement.id && task.status === 'Under Review')).length,
  };
}

export function getClient(clientId: string) {
  const store = getSnapshot();
  return store.clients.find((client) => client.id === clientId);
}

export function updateTask(taskId: string, patch: { status?: TaskStatus; assignedTo?: string }) {
  const store = getStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  if (patch.status) task.status = patch.status;
  if (patch.assignedTo) task.assignedTo = patch.assignedTo;
  task.updatedAt = '01 Oct 2026';
  store.activities.unshift({ id: `activity-${Date.now()}`, type: patch.status === 'Completed' ? 'Task completed' : 'Status changed', description: `${task.title} updated in the demonstration environment`, actor: 'Demo Manager', timestamp: 'Just now', recordType: 'Task', recordId: task.id });
  return getSnapshot();
}

export function createQuotation(input: { clientId: string; service: string; description: string; terms: string; items: QuotationItem[] }): DemoSnapshot {
  const store = getStore();
  const quotation: Quotation = { id: `quote-${Date.now()}`, ...input, status: 'Ready for review', createdAt: '01 Oct 2026' };
  store.quotations.unshift(quotation);
  store.activities.unshift({ id: `activity-${Date.now()}-quote`, type: 'Status changed', description: 'Demonstration quotation prepared for review', actor: 'Demo Manager', timestamp: 'Just now', recordType: 'Client', recordId: input.clientId });
  return getSnapshot();
}

export function createReport(input: { clientId: string; engagementId: string; reportType: string }): { snapshot: DemoSnapshot; report: ReportRecord } {
  const store = getStore();
  const report: ReportRecord = { id: `report-${Date.now()}`, ...input, status: 'Draft / Demonstration', createdAt: '01 Oct 2026' };
  store.reports.unshift(report);
  store.activities.unshift({ id: `activity-${Date.now()}-report`, type: 'Status changed', description: 'Draft demonstration report generated', actor: 'Demo Manager', timestamp: 'Just now', recordType: 'Engagement', recordId: input.engagementId });
  return { snapshot: getSnapshot(), report };
}

export function searchForAssistant(question: string) {
  const store = getSnapshot();
  const lower = question.toLowerCase();
  const attendanceData = getAttendance();
  if (lower.includes('check in') || lower.includes('checked in') || lower.includes('late') || lower.includes('attendance')) {
    const targetStatus = lower.includes('late') ? 'Late' : 'Not Checked In';
    const names = attendanceData.records.filter((record) => record.date === '2026-10-01' && record.status === targetStatus).map((record) => ({ ...record, name: store.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId }));
    return { tool: lower.includes('late') ? 'get_late_staff' : 'get_attendance_status', records: names };
  }
  if (lower.includes('trial balance') || lower.includes('balance sheet') || lower.includes('income statement') || lower.includes('ledger') || lower.includes('financial position')) return { tool: 'get_trial_balance', records: [getAccounting()] };
  if (lower.includes('firm') || lower.includes('management') || lower.includes('attention')) return { tool: 'get_management_overview', records: [getMetrics(store), getAttendance(), getAccounting()] };
  const overdue = store.tasks.filter((task) => task.status !== 'Completed' && isBeforeToday(task.dueDate));
  const activeEngagements = store.engagements.filter((engagement) => engagement.status !== 'Completed');
  if (lower.includes('overdue') || lower.includes('attention')) return { tool: 'get_overdue_tasks', records: overdue };
  if (lower.includes('deadline') || lower.includes('approach')) return { tool: 'get_upcoming_deadlines', records: activeEngagements };
  if (lower.includes('workload') || lower.includes('auditor')) return { tool: 'get_staff_workload', records: store.staff };
  if (lower.includes('active audit') || lower.includes('engagement')) return { tool: 'search_engagements', records: activeEngagements };
  const client = store.clients.find((item) => lower.includes(item.name.toLowerCase().split(' ')[0].toLowerCase()));
  if (client) return { tool: 'get_client', records: [client, ...store.engagements.filter((item) => client.engagementIds.includes(item.id))] };
  return { tool: 'get_recent_activity', records: store.activities };
}

export function formatAssistantAnswer(question: string, result: ReturnType<typeof searchForAssistant>) {
  const store = getSnapshot();
  if (result.tool === 'get_attendance_status' || result.tool === 'get_late_staff') {
    const records = result.records as Array<{ name: string; status: string; checkIn: string | null }>;
    const relevant = result.tool === 'get_late_staff' ? records.filter((record) => record.status === 'Late') : records;
    return relevant.length ? `${result.tool === 'get_late_staff' ? 'Late staff today:' : 'Staff requiring attendance attention today:'}\n\n${relevant.map((record) => `• ${record.name}${record.checkIn ? ` — checked in at ${record.checkIn}` : ' — has not checked in'}`).join('\n')}\n\nApproved leave is excluded from missed check-in results.` : 'No staff members match that attendance query in the demonstration records.';
  }
  if (result.tool === 'get_trial_balance') {
    const accounting = result.records[0] as AccountingSnapshot;
    return `The deterministic accounting engine reports revenue of ${accounting.incomeStatement.revenue.toLocaleString('en-KE')} KES, expenses of ${accounting.incomeStatement.expenses.toLocaleString('en-KE')} KES and net profit of ${accounting.incomeStatement.netProfit.toLocaleString('en-KE')} KES. The balance sheet is ${accounting.balanceSheet.balanced ? 'balanced' : 'out of balance'} with assets of ${accounting.balanceSheet.assets.toLocaleString('en-KE')} KES.`;
  }
  if (result.tool === 'get_management_overview') return `The firm has ${store.clients.filter((client) => client.status === 'Active').length} active clients, ${store.engagements.length} active engagements, ${getMetrics(store).overdueTasks} overdue tasks, ${getAttendance().records.filter((record) => record.date === '2026-10-01' && record.status === 'Not Checked In').length} named staff members not checked in, and a deterministic accounting net profit of ${getAccounting().incomeStatement.netProfit.toLocaleString('en-KE')} KES in the fictional period.`;
  if (result.tool === 'get_overdue_tasks') {
    const tasks = result.records as typeof store.tasks;
    return tasks.length ? `I found ${tasks.length} overdue items requiring attention:\n\n${tasks.slice(0, 5).map((task, index) => `${index + 1}. ${task.title} — due ${task.dueDate}; ${store.clients.find((client) => client.id === task.clientId)?.name ?? 'Client'} (${task.priority} priority)`).join('\n')}` : 'No overdue tasks are currently recorded in the demonstration environment.';
  }
  if (result.tool === 'get_upcoming_deadlines') {
    const engagements = result.records as typeof store.engagements;
    return `I found ${engagements.length} active engagements with deadlines in the current work queue:\n\n${engagements.slice(0, 5).map((engagement, index) => `${index + 1}. ${store.clients.find((client) => client.id === engagement.clientId)?.name} — ${engagement.deadline}; ${engagement.progress}% complete`).join('\n')}`;
  }
  if (result.tool === 'get_staff_workload') {
    const staff = result.records as typeof store.staff;
    const busiest = [...staff].sort((a, b) => b.assignedTasks - a.assignedTasks)[0];
    return `${busiest.name} currently carries the largest assigned task load at ${busiest.assignedTasks} tasks, with ${busiest.overdueTasks} overdue. Review the workload panel for the full team view.`;
  }
  if (result.tool === 'search_engagements') {
    const engagements = result.records as typeof store.engagements;
    return `There are ${engagements.length} active engagements in the demonstration environment. The most advanced is ${engagements.sort((a, b) => b.progress - a.progress)[0]?.name} at ${engagements.sort((a, b) => b.progress - a.progress)[0]?.progress}% progress.`;
  }
  if (result.tool === 'get_client') {
    const client = result.records[0] as typeof store.clients[number];
    const engagement = store.engagements.find((item) => item.clientId === client.id);
    return `${client.name} is an ${client.status.toLowerCase()} demonstration client in ${client.industry}. Current engagement: ${engagement?.name ?? 'None'}, ${engagement?.progress ?? 0}% progress, deadline ${engagement?.deadline ?? 'not set'}. There are ${client.outstandingRequests} outstanding requests and ${client.documentCount} documents recorded.`;
  }
  return `The latest activity includes ${store.activities.slice(0, 3).map((item) => item.description.toLowerCase()).join('; ')}.`;
}
