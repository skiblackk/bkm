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

export function presenceLabel(record: ReturnType<typeof getPresence>) {
  if (record.online) return 'Online now';
  if (!record.lastActiveAt) return 'Offline';
  const minutes = Math.max(1, Math.round((Date.now() - new Date(record.lastActiveAt).getTime()) / 60_000));
  if (minutes < 60) return `Active ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (minutes < 24 * 60) return `Active ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'} ago`;
  return `Last active ${new Date(record.lastActiveAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
}
