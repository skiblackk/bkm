import { isProductionDataMode, hasSupabaseConfiguration } from './runtime-mode';
import * as demo from './repository';
import * as production from './supabase-repository';
import type { DemoSnapshot, InternalMessage, Quotation, ReportRecord, TaskPriority, TaskStatus } from './types';
import type { AccountingSnapshot, DocumentExtraction, JournalEntry } from './extended-types';
import type { AuditEvent } from './access-control';

/**
 * Repository dispatch. In production the Supabase repository serves real
 * records; outside production the in-memory demonstration store serves the
 * seeded fixtures. Both stores implement the same contract, so routes and
 * screens are identical in either mode.
 */

function assertRepositoryReady() {
  if (isProductionDataMode && !hasSupabaseConfiguration) {
    throw new Error('The production Supabase repository is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.');
  }
}

const useProduction = () => isProductionDataMode && hasSupabaseConfiguration;

export async function getSnapshot(): Promise<DemoSnapshot> {
  if (useProduction()) return production.getSnapshot();
  assertRepositoryReady();
  return demo.getSnapshot();
}

export const getMetrics = demo.getMetrics;

export async function getClient(clientId: string) {
  if (useProduction()) return production.getClient(clientId);
  assertRepositoryReady();
  return demo.getClient(clientId);
}

export async function addStaffMember(member: DemoSnapshot['staff'][number]) {
  if (useProduction()) return production.addStaffMember(member);
  assertRepositoryReady();
  return demo.addStaffMember(member);
}

export async function getAttendance() {
  if (useProduction()) return production.getAttendance();
  assertRepositoryReady();
  return demo.getAttendance();
}

export async function updateAttendance(staffId: string, action: 'check-in' | 'check-out', note?: string) {
  if (useProduction()) return production.updateAttendance(staffId, action, note);
  assertRepositoryReady();
  return demo.updateAttendance(staffId, action, note);
}

export async function getInternalMessages(): Promise<InternalMessage[]> {
  if (useProduction()) return production.getInternalMessages();
  assertRepositoryReady();
  return demo.getInternalMessages();
}

export async function sendInternalMessage(input: { senderId: string; senderName: string; recipientId: string | 'all'; recipientName: string; body: string; kind?: 'direct' | 'broadcast' | 'alert' }) {
  if (useProduction()) return production.sendInternalMessage(input);
  assertRepositoryReady();
  return demo.sendInternalMessage(input);
}

export async function removeUser(staffId: string) {
  if (useProduction()) return production.removeUser(staffId);
  assertRepositoryReady();
  return demo.removeUser(staffId);
}

export async function assignTask(taskId: string, staffId: string) {
  if (useProduction()) return production.assignTask(taskId, staffId);
  assertRepositoryReady();
  return demo.assignTask(taskId, staffId);
}

export async function getAccounting(options?: { periodStart?: string; periodEnd?: string }): Promise<AccountingSnapshot> {
  if (useProduction()) return production.getAccounting(options);
  assertRepositoryReady();
  return demo.getAccounting(options);
}

export async function addJournalEntry(entry: JournalEntry) {
  if (useProduction()) return production.addJournalEntry(entry);
  assertRepositoryReady();
  return demo.addJournalEntry(entry);
}

export async function reverseJournalEntry(reference: string) {
  if (useProduction()) return production.reverseJournalEntry(reference);
  assertRepositoryReady();
  return demo.reverseJournalEntry(reference);
}

export async function getDocumentIntelligence(): Promise<DocumentExtraction> {
  if (useProduction()) return production.getDocumentIntelligence();
  assertRepositoryReady();
  return demo.getDocumentIntelligence();
}

export async function approveDocument() {
  if (useProduction()) return production.approveDocument();
  assertRepositoryReady();
  return demo.approveDocument();
}

export async function recordAudit(input: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent> {
  if (useProduction()) return production.recordAudit(input);
  assertRepositoryReady();
  return demo.recordAudit(input);
}

export async function getAuditEvents(filters?: { actorId?: string; action?: string }): Promise<AuditEvent[]> {
  if (useProduction()) return production.getAuditEvents(filters);
  assertRepositoryReady();
  return demo.getAuditEvents(filters);
}

export async function createClient(input: { name: string; industry: string; location: string; contactName: string; contactEmail: string; contactPhone?: string; services?: string[]; description?: string }) {
  if (useProduction()) return production.createClient(input);
  assertRepositoryReady();
  return demo.createClient(input);
}

export async function updateTask(taskId: string, patch: { status?: TaskStatus; assignedTo?: string }) {
  if (useProduction()) return production.updateTask(taskId, patch);
  assertRepositoryReady();
  return demo.updateTask(taskId, patch);
}

export async function createTask(input: { title: string; description?: string; clientId?: string; engagementId?: string; assignedTo?: string; priority?: TaskPriority; dueDate?: string }) {
  if (useProduction()) return production.createTask(input);
  assertRepositoryReady();
  return demo.createTask(input);
}

export async function createQuotation(input: { clientId: string; service: string; description: string; terms: string; items: { id: string; description: string; quantity: number; unitPrice: number }[] }): Promise<DemoSnapshot> {
  if (useProduction()) return production.createQuotation(input);
  assertRepositoryReady();
  return demo.createQuotation(input);
}

export async function createReport(input: { clientId: string; engagementId: string; reportType: string }): Promise<{ snapshot: DemoSnapshot; report: ReportRecord }> {
  if (useProduction()) return production.createReport(input);
  assertRepositoryReady();
  return demo.createReport(input);
}

export async function searchForAssistant(question: string) {
  if (useProduction()) return production.searchForAssistant(question);
  assertRepositoryReady();
  return demo.searchForAssistant(question);
}

export async function formatAssistantAnswer(question: string, result: Awaited<ReturnType<typeof searchForAssistant>>): Promise<string> {
  if (useProduction()) return production.formatAssistantAnswer(question, result as Awaited<ReturnType<typeof production.searchForAssistant>>);
  assertRepositoryReady();
  return demo.formatAssistantAnswer(question, result as ReturnType<typeof demo.searchForAssistant>);
}

export async function listWorkspaceUsers() {
  if (useProduction()) return (await import('./supabase-repository')).listWorkspaceUsers();
  return (await import('./auth')).listDemoAccounts();
}

