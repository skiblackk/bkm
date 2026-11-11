import { businessDate } from './business-clock';

export function isBeforeToday(dateLabel: string) {
  const date = new Date(dateLabel.replace(/(\d+)(st|nd|rd|th)/, '$1'));
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < new Date(`${businessDate()}T00:00:00+03:00`).getTime();
}

export function isWithinNextDays(dateLabel: string, days: number) {
  const date = new Date(dateLabel.replace(/(\d+)(st|nd|rd|th)/, '$1'));
  const start = new Date(`${businessDate()}T00:00:00+03:00`).getTime();
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= start && date.getTime() <= start + days * 24 * 60 * 60 * 1000;
}
