import type { CommunicationAlert } from './communication-webhooks';

export type TriagePriority = 'Urgent' | 'High' | 'Normal' | 'Low';
export type TriageStatus = 'Needs approval' | 'Approved' | 'Rejected';

export type AiTriageItem = {
  id: string;
  alertId: string;
  channel: CommunicationAlert['channel'];
  senderName: string;
  subject?: string;
  message: string;
  priority: TriagePriority;
  summary: string;
  reasoning: string;
  suggestedReply: string;
  status: TriageStatus;
  createdAt: string;
};

let decisions: Record<string, Pick<AiTriageItem, 'status' | 'suggestedReply'>> = {};

function classify(message: string, subject?: string): Pick<AiTriageItem, 'priority' | 'summary' | 'reasoning' | 'suggestedReply'> {
  const text = `${subject ?? ''} ${message}`.toLowerCase();
  const urgent = /urgent|immediately|today|deadline|blocked|fraud|incident|payment due/.test(text);
  const high = /audit|tax|financial|invoice|bank|client|approval|review/.test(text);
  const priority: TriagePriority = urgent ? 'Urgent' : high ? 'High' : 'Normal';
  const summary = subject ? `${subject}: ${message}` : message;
  const reasoning = urgent
    ? 'The message contains time-sensitive or risk-related language. Benjamin should review it before any commitment is made.'
    : high
      ? 'The message appears related to client delivery, finance, tax, audit, or approval work and should be checked against BKM records.'
      : 'The message appears operational and does not contain an obvious escalation signal, but the context should still be reviewed.';
  const suggestedReply = urgent
    ? 'Thank you for flagging this. Benjamin is reviewing the matter and the BKM team will confirm the next step shortly.'
    : 'Thank you for your message. We have received it and will review the details before responding with the next step.';
  return { priority, summary, reasoning, suggestedReply };
}

export function getAiTriageItems(alerts: CommunicationAlert[]): AiTriageItem[] {
  if (!alerts.length) return [];
  return alerts.map((alert) => {
    const base = classify(alert.body, alert.subject);
    const decision = decisions[alert.id];
    return { id: `triage-${alert.id}`, alertId: alert.id, channel: alert.channel, senderName: alert.senderName, subject: alert.subject, message: alert.body, ...base, status: decision?.status ?? 'Needs approval', suggestedReply: decision?.suggestedReply ?? base.suggestedReply, createdAt: alert.createdAt };
  });
}

export function decideAiTriage(id: string, status: Exclude<TriageStatus, 'Needs approval'>, suggestedReply?: string) {
  decisions[id.replace(/^triage-/, '')] = { status, suggestedReply: suggestedReply?.trim() || 'Thank you for your message. We have received it and will review the details before responding with the next step.' };
  return status;
}
