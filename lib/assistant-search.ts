import type { DashboardMetrics, DemoSnapshot, InternalMessage } from './types';
import type { AccountingSnapshot, AttendanceRecord, DocumentExtraction } from './extended-types';
import { isBeforeToday } from './date-label';

export interface AssistantData {
  snapshot: DemoSnapshot;
  attendance: { settings: { expectedCheckIn: string; graceMinutes: number; workingDays: string[] }; records: AttendanceRecord[] };
  accounting: AccountingSnapshot;
  demoDate: string;
  metrics: DashboardMetrics;
}

/**
 * Deterministic workspace search used by the assistant's tool layer. Pure over
 * the provided records so the demonstration store and the Supabase repository
 * produce identical answers from identical data.
 */
export function searchWorkspaceForAssistant(question: string, data: AssistantData) {
  const store = data.snapshot;
  const lower = question.toLowerCase();
  const attendanceData = data.attendance;
  if (lower.includes('check in') || lower.includes('checked in') || lower.includes('late') || lower.includes('attendance')) {
    const targetStatus = lower.includes('late') ? 'Late' : 'Not Checked In';
    const names = attendanceData.records.filter((record) => record.date === data.demoDate && record.status === targetStatus).map((record) => ({ ...record, name: store.staff.find((member) => member.id === record.staffId)?.name ?? record.staffId }));
    return { tool: lower.includes('late') ? 'get_late_staff' : 'get_attendance_status', records: names };
  }
  if (lower.includes('trial balance') || lower.includes('balance sheet') || lower.includes('income statement') || lower.includes('ledger') || lower.includes('financial position')) return { tool: 'get_trial_balance', records: [data.accounting] };
  if (lower.includes('firm') || lower.includes('management') || lower.includes('attention')) return { tool: 'get_management_overview', records: [data.metrics, data.attendance, data.accounting] };
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

export type AssistantSearchResult = ReturnType<typeof searchWorkspaceForAssistant>;

export function formatWorkspaceAssistantAnswer(question: string, result: AssistantSearchResult, data: AssistantData) {
  const store = data.snapshot;
  if (result.tool === 'get_attendance_status' || result.tool === 'get_late_staff') {
    const records = result.records as Array<{ name: string; status: string; checkIn: string | null }>;
    const relevant = result.tool === 'get_late_staff' ? records.filter((record) => record.status === 'Late') : records;
    return relevant.length ? `${result.tool === 'get_late_staff' ? 'Late staff today:' : 'Staff requiring attendance attention today:'}\n\n${relevant.map((record) => `• ${record.name}${record.checkIn ? ` — checked in at ${record.checkIn}` : ' — has not checked in'}`).join('\n')}\n\nApproved leave is excluded from missed check-in results.` : 'No staff members match that attendance query in the demonstration records.';
  }
  if (result.tool === 'get_trial_balance') {
    const accounting = result.records[0] as AccountingSnapshot;
    const lines = accounting.accounts.filter((account) => account.type === 'Asset' || account.type === 'Liability' || account.type === 'Equity').map((account) => `${account.name}: ${account.balance.toLocaleString('en-KE')} KES`).join('\n');
    return question.toLowerCase().includes('balance sheet') || question.toLowerCase().includes('financial position')
      ? `Balance sheet — deterministic accounting engine\n\n${lines}\nCurrent-period profit: ${accounting.incomeStatement.netProfit.toLocaleString('en-KE')} KES\n\nTotal assets: ${accounting.balanceSheet.assets.toLocaleString('en-KE')} KES\nLiabilities: ${accounting.balanceSheet.liabilities.toLocaleString('en-KE')} KES\nEquity including current-period profit: ${accounting.balanceSheet.equity.toLocaleString('en-KE')} KES\n\nCheck: assets ${accounting.balanceSheet.balanced ? 'equal' : 'do not equal'} liabilities plus equity.`
      : `The deterministic accounting engine reports revenue of ${accounting.incomeStatement.revenue.toLocaleString('en-KE')} KES, expenses of ${accounting.incomeStatement.expenses.toLocaleString('en-KE')} KES and net profit of ${accounting.incomeStatement.netProfit.toLocaleString('en-KE')} KES. The balance sheet is ${accounting.balanceSheet.balanced ? 'balanced' : 'out of balance'} with assets of ${accounting.balanceSheet.assets.toLocaleString('en-KE')} KES.`;
  }
  if (result.tool === 'get_management_overview') return `The firm has ${store.clients.filter((client) => client.status === 'Active').length} active clients, ${store.engagements.length} active engagements, ${data.metrics.overdueTasks} overdue tasks, ${data.attendance.records.filter((record) => record.date === data.demoDate && record.status === 'Not Checked In').length} named staff members not checked in, and a deterministic accounting net profit of ${data.accounting.incomeStatement.netProfit.toLocaleString('en-KE')} KES in the fictional period.`;
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
