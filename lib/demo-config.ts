export const DEMO_DATE = process.env.NEXT_PUBLIC_BKM_DEMO_DATE || '2026-10-01';
export const DEMO_PERIOD_LABEL = 'September 2026';
export const DEMO_TIMEZONE = 'Africa/Nairobi';

export function getConfiguredDemoDate() {
  const value = process.env.BKM_DEMO_DATE || DEMO_DATE;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : DEMO_DATE;
}

export function formatDemoDate(date = getConfiguredDemoDate()) {
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'long', timeZone: DEMO_TIMEZONE }).format(new Date(`${date}T00:00:00+03:00`));
}
