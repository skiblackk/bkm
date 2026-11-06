// Access control primitives. The granular catalogue lives in
// lib/permission-catalogue.ts (generated from scripts/gen-rbac-catalogue.py and
// mirrored in the `permissions` database table). The legacy seven-key
// catalogue is preserved as a compatibility surface so existing grants and
// checks continue to work while the granular model takes over.

import { PERMISSION_CATALOGUE, type PermissionEntry, ROLE_TEMPLATES, RESOURCE_TYPES, ACCESS_LEVELS, ADMIN_BYPASS_EXCLUSIONS } from './permission-catalogue';

export const permissionCatalog = [
  { id: 'view_dashboard', label: 'View dashboard' },
  { id: 'manage_clients', label: 'Manage clients and engagements' },
  { id: 'manage_tasks', label: 'Create and update tasks' },
  { id: 'view_finance', label: 'View finance and reports' },
  { id: 'use_assistant', label: 'Use the AI assistant' },
  { id: 'send_messages', label: 'Send internal messages' },
  { id: 'manage_documents', label: 'Upload and review documents' },
] as const;

export type PermissionId = string;
export type GranularPermission = PermissionEntry['key'];
export type UserRole = 'Audit Manager' | 'Senior Auditor' | 'Audit Associate' | 'Finance Lead' | 'Viewer' | 'System Administrator' | 'CEO / Managing Partner' | 'Operations Manager' | 'HR / Administration' | 'General Staff' | string;

export interface ProvisionedUser { account: string; name: string; email: string; role: UserRole; initials: string; isAdmin: false; staffId: string; permissions: PermissionId[]; active: boolean; }
export interface AuditEvent { id: string; actorId: string; actorName: string; actorRole: string; action: string; targetType: string; targetId?: string; detail: string; timestamp: string; severity: 'info' | 'security' | 'change'; }

export { PERMISSION_CATALOGUE, ROLE_TEMPLATES, RESOURCE_TYPES, ACCESS_LEVELS, ADMIN_BYPASS_EXCLUSIONS };
export type { PermissionEntry };

/** Roles whose holders are platform administrators (consistent with the SQL helper). */
export const ADMIN_ROLE_NAMES = ['CEO', 'CEO / Managing Partner', 'Managing Partner', 'Administrator', 'System Administrator'] as const;

/**
 * Legacy checks and the granular keys that satisfy them (and vice versa).
 * A check passes when the user's effective grants contain at least one key
 * from the matching list.
 */
const LEGACY_SUCCESSORS: Record<string, string[]> = {
  view_dashboard: ['view_dashboard', 'view_personal_dashboard', 'view_team_dashboard', 'view_executive_dashboard'],
  manage_clients: ['manage_clients', 'manage_engagements'],
  manage_tasks: ['manage_tasks', 'create_tasks', 'edit_team_tasks', 'assign_tasks'],
  view_finance: ['view_finance', 'view_financial_reports'],
  use_assistant: ['use_assistant'],
  send_messages: ['send_messages'],
  manage_documents: ['manage_documents', 'upload_documents', 'edit_team_documents', 'approve_documents'],
};

const SATISFIES: Record<string, string[]> = {};
for (const [legacy, successors] of Object.entries(LEGACY_SUCCESSORS)) {
  SATISFIES[legacy] = successors;
  for (const successor of successors) {
    const existing = SATISFIES[successor] ?? [successor];
    if (!existing.includes(legacy)) existing.push(legacy);
    SATISFIES[successor] = existing;
  }
}

/** True when the effective grant set satisfies the requested permission check. */
export function grantsSatisfy(effective: ReadonlySet<string>, permission: PermissionId): boolean {
  const accepted = SATISFIES[permission] ?? [permission];
  return accepted.some((key) => effective.has(key));
}
