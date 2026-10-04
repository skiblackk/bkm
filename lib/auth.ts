import { cookies } from 'next/headers';

const demoAccounts = {
  benjamin: { account: 'benjamin', name: 'Benjamin Kimani', role: 'System Administrator', initials: 'BK', isAdmin: true, staffId: null },
  david: { account: 'david', name: 'David Kamau', role: 'Audit Manager', initials: 'DK', isAdmin: false, staffId: 'staff-david' },
  mary: { account: 'mary', name: 'Mary Wanjiku', role: 'Senior Auditor', initials: 'MW', isAdmin: false, staffId: 'staff-mary' },
  faith: { account: 'faith', name: 'Faith Njeri', role: 'Audit Associate', initials: 'FN', isAdmin: false, staffId: 'staff-faith' },
  brian: { account: 'brian', name: 'Brian Otieno', role: 'Audit Associate', initials: 'BO', isAdmin: false, staffId: 'staff-brian' },
} as const;

export type DemoAccount = keyof typeof demoAccounts;
export type DemoSession = (typeof demoAccounts)[DemoAccount];

export function getDemoAccount(account: string | undefined): DemoSession | null {
  if (!account || !(account in demoAccounts)) return null;
  return demoAccounts[account as DemoAccount];
}

export async function getDemoSession() {
  const store = await cookies();
  const account = store.get('bkm_demo_session')?.value;
  return getDemoAccount(account);
}
