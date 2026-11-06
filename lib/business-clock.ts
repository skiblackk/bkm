import { DEMO_TIMEZONE } from './demo-config';

/**
 * Business-time helpers. Every date the UI or API calls "today" must be the
 * company's local day (Africa/Nairobi, UTC+3), never the server's UTC day —
 * otherwise attendance recorded just after midnight lands on the wrong day.
 */
export function businessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DEMO_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 24-hour local clock, e.g. "08:07". */
export function businessTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: DEMO_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

export function minutesFromClock(clock: string): number {
  const [hours, minutes] = clock.split(':').map((part) => Number(part));
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

/** Present / Late decided by the configured expected check-in plus grace, never hardcoded. */
export function attendanceStatusFor(checkIn: string, expectedCheckIn: string, graceMinutes: number): 'Present' | 'Late' {
  return minutesFromClock(checkIn) > minutesFromClock(expectedCheckIn) + graceMinutes ? 'Late' : 'Present';
}

export function durationMinutesBetween(checkIn: string, checkOut: string): number {
  return Math.max(0, minutesFromClock(checkOut) - minutesFromClock(checkIn));
}
