import type { DemoSession } from './auth';

type PresenceRecord = { staffId: string; account: string; lastActiveAt: string };

declare global { var __bkmPresence: Record<string, PresenceRecord> | undefined; }

const presence = globalThis.__bkmPresence ?? (globalThis.__bkmPresence = {});
const ONLINE_WINDOW_MS = 90_000;

export function touchPresence(session: DemoSession) {
  const staffId = session.staffId ?? session.account;
  presence[staffId] = { staffId, account: session.account, lastActiveAt: new Date().toISOString() };
  return presence[staffId];
}

export function getPresence(staffId: string) {
  const record = presence[staffId];
  if (!record) return { staffId, online: false, lastActiveAt: null };
  return { ...record, online: Date.now() - new Date(record.lastActiveAt).getTime() <= ONLINE_WINDOW_MS };
}

export function getPresenceFor(staffIds: string[]) {
  return staffIds.map((staffId) => getPresence(staffId));
}

