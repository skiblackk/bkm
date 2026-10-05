import { cookies } from 'next/headers';
import type { PermissionId, ProvisionedUser, UserRole } from './access-control';

export interface DemoSession { account: string; name: string; role: string; initials: string; isAdmin: boolean; staffId: string | null; permissions: PermissionId[]; email?: string; }
const fullAccess: PermissionId[] = ['view_dashboard', 'manage_clients', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'];
const demoAccounts: Record<string, DemoSession> = {
  benjamin: { account: 'benjamin', name: 'Benjamin Mutua', role: 'System Administrator', initials: 'BM', isAdmin: true, staffId: null, permissions: fullAccess },
  david: { account: 'david', name: 'David Kamau', role: 'Audit Manager', initials: 'DK', isAdmin: false, staffId: 'staff-david', permissions: ['view_dashboard', 'manage_clients', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'] },
  mary: { account: 'mary', name: 'Mary Wanjiku', role: 'Senior Auditor', initials: 'MW', isAdmin: false, staffId: 'staff-mary', permissions: ['view_dashboard', 'manage_tasks', 'view_finance', 'use_assistant', 'send_messages', 'manage_documents'] },
  faith: { account: 'faith', name: 'Faith Njeri', role: 'Audit Associate', initials: 'FN', isAdmin: false, staffId: 'staff-faith', permissions: ['view_dashboard', 'manage_tasks', 'use_assistant', 'send_messages', 'manage_documents'] },
  brian: { account: 'brian', name: 'Brian Otieno', role: 'Audit Associate', initials: 'BO', isAdmin: false, staffId: 'staff-brian', permissions: ['view_dashboard', 'manage_tasks', 'use_assistant', 'send_messages', 'manage_documents'] },
};

export type DemoAccount = string;
export function getDemoAccount(account: string | undefined): DemoSession | null { return account && demoAccounts[account] ? demoAccounts[account] : null; }
export function listDemoAccounts() { return Object.values(demoAccounts).map((account) => ({ ...account, permissions: [...account.permissions] })); }
export function provisionDemoUser(input: { name: string; email: string; role: UserRole; permissions: PermissionId[] }): DemoSession {
  const account = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || `user.${Date.now()}`;
  const unique = demoAccounts[account] ? `${account}.${Date.now().toString().slice(-4)}` : account;
  const staffId = `staff-${unique.replace(/\./g, '-')}`;
  const user: ProvisionedUser = { account: unique, name: input.name.trim(), email: input.email.trim(), role: input.role, initials: input.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(), isAdmin: false, staffId, permissions: input.permissions, active: true };
  demoAccounts[unique] = user;
  return user;
}
export async function getDemoSession() { const store = await cookies(); return getDemoAccount(store.get('bkm_demo_session')?.value); }
