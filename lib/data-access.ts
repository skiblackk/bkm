import { hasSupabaseConfiguration } from './runtime-mode';
import * as production from './supabase-repository';
import type { DemoSnapshot, InternalMessage, Quotation, ReportRecord, TaskPriority, TaskStatus } from './types';
import type { AccountingSnapshot, DocumentExtraction, JournalEntry } from './extended-types';
import type { AuditEvent } from './access-control';

/**
 * Data access. There is exactly one store: the Supabase repository. The
 * in-memory demonstration store was removed, so a missing configuration is an
 * error rather than a silent switch to fixture data.
 */

function assertRepositoryReady() {
  if (!hasSupabaseConfiguration) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.');
  }
}

export async function getSnapshot(): Promise<DemoSnapshot> {
  assertRepositoryReady();
  return production.getSnapshot();
}

export { getMetrics } from './repository-metrics';

export async function getClient(clientId: string) {
  assertRepositoryReady();
  return production.getClient(clientId);
}

export async function addStaffMember(member: DemoSnapshot['staff'][number]) {
  assertRepositoryReady();
  return production.addStaffMember(member);
}

export async function getAttendance() {
  assertRepositoryReady();
  return production.getAttendance();
}

export async function updateAttendance(staffId: string, action: 'check-in' | 'check-out', note?: string) {
  assertRepositoryReady();
  return production.updateAttendance(staffId, action, note);
}

export async function getInternalMessages(): Promise<InternalMessage[]> {
  assertRepositoryReady();
  return production.getInternalMessages();
}

export async function sendInternalMessage(input: { senderId: string; senderName: string; recipientId: string | 'all'; recipientName: string; body: string; kind?: 'direct' | 'broadcast' | 'alert' }) {
  assertRepositoryReady();
  return production.sendInternalMessage(input);
}

export async function removeUser(staffId: string) {
  assertRepositoryReady();
  return production.removeUser(staffId);
}

export async function assignTask(taskId: string, staffId: string) {
  assertRepositoryReady();
  return production.assignTask(taskId, staffId);
}

export async function getAccounting(options?: { periodStart?: string; periodEnd?: string }): Promise<AccountingSnapshot> {
  assertRepositoryReady();
  return production.getAccounting(options);
}

export async function addJournalEntry(entry: JournalEntry, createdBy?: string | null) {
  assertRepositoryReady();
  return production.addJournalEntry(entry, createdBy);
}

export async function updateJournalStatus(reference: string, options: { to: string; from: string[]; actorId: string; actorName: string; isAdmin: boolean; overrideReason?: string }) {
  assertRepositoryReady();
  return production.updateJournalStatus(reference, options);
}

export async function reverseJournalEntry(reference: string) {
  assertRepositoryReady();
  return production.reverseJournalEntry(reference);
}

export async function getDocumentIntelligence(): Promise<DocumentExtraction> {
  assertRepositoryReady();
  return production.getDocumentIntelligence();
}

export async function approveDocument() {
  assertRepositoryReady();
  return production.approveDocument();
}

export async function recordAudit(input: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> {
  assertRepositoryReady();
  return production.recordAudit(input);
}

export async function getAuditEvents(filters?: { actorId?: string; action?: string }): Promise<AuditEvent[]> {
  assertRepositoryReady();
  return production.getAuditEvents(filters);
}

export async function createClient(input: { name: string; industry: string; location: string; contactName: string; contactEmail: string; contactPhone?: string; services?: string[]; description?: string }) {
  assertRepositoryReady();
  return production.createClient(input);
}

export async function updateTask(taskId: string, patch: { status?: TaskStatus; assignedTo?: string }) {
  assertRepositoryReady();
  return production.updateTask(taskId, patch);
}

export async function createTask(input: { title: string; description?: string; clientId?: string; engagementId?: string; assignedTo?: string; priority?: TaskPriority; dueDate?: string }) {
  assertRepositoryReady();
  return production.createTask(input);
}

export async function createQuotation(input: { clientId: string; service: string; description: string; terms: string; items: { id: string; description: string; quantity: number; unitPrice: number }[] }): Promise<DemoSnapshot> {
  assertRepositoryReady();
  return production.createQuotation(input);
}

export async function createReport(input: { clientId: string; engagementId: string; reportType: string }): Promise<{ snapshot: DemoSnapshot; report: ReportRecord }> {
  assertRepositoryReady();
  return production.createReport(input);
}

export async function searchForAssistant(question: string) {
  assertRepositoryReady();
  return production.searchForAssistant(question);
}

export async function formatAssistantAnswer(question: string, result: Awaited<ReturnType<typeof searchForAssistant>>): Promise<string> {
  assertRepositoryReady();
  return production.formatAssistantAnswer(question, result as Awaited<ReturnType<typeof production.searchForAssistant>>);
}

export async function listWorkspaceUsers() {
  assertRepositoryReady();
  return (await import('./supabase-repository')).listWorkspaceUsers();
}

export async function wipeWorkspaceData() {
  assertRepositoryReady();
  return (await import('./supabase-repository')).wipeWorkspaceData();
}

export async function provisionUser(input: { name: string; email: string; roleTitle: string; password?: string; isAdmin?: boolean; permissions?: string[] }) {
  assertRepositoryReady();
  return (await import('./supabase-repository')).provisionUser(input);
}
