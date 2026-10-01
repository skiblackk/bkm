import { cookies } from 'next/headers';

const demoAccounts = {
  david: { name: 'David Kamau', role: 'Audit Manager', initials: 'DK' },
  mary: { name: 'Mary Wanjiku', role: 'Senior Auditor', initials: 'MW' },
  faith: { name: 'Faith Njeri', role: 'Audit Associate', initials: 'FN' },
} as const;

export type DemoAccount = keyof typeof demoAccounts;

export function getDemoAccount(account: string | undefined) {
  if (!account || !(account in demoAccounts)) return null;
  return demoAccounts[account as DemoAccount];
}

export async function getDemoSession() {
  const store = await cookies();
  const account = store.get('bkm_demo_session')?.value;
  return getDemoAccount(account);
}
