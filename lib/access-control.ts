export const permissionCatalog = [
  { id: 'view_dashboard', label: 'View dashboard' },
  { id: 'manage_clients', label: 'Manage clients and engagements' },
  { id: 'manage_tasks', label: 'Create and update tasks' },
  { id: 'view_finance', label: 'View finance and reports' },
  { id: 'use_assistant', label: 'Use the AI assistant' },
  { id: 'send_messages', label: 'Send internal messages' },
  { id: 'manage_documents', label: 'Upload and review documents' },
] as const;

export type PermissionId = (typeof permissionCatalog)[number]['id'];
export type UserRole = 'Audit Manager' | 'Senior Auditor' | 'Audit Associate' | 'Finance Lead' | 'Viewer';
export interface ProvisionedUser { account: string; name: string; email: string; role: UserRole; initials: string; isAdmin: false; staffId: string; permissions: PermissionId[]; active: boolean; }
export interface AuditEvent { id: string; actorId: string; actorName: string; actorRole: string; action: string; targetType: string; targetId?: string; detail: string; timestamp: string; severity: 'info' | 'security' | 'change'; }
