/**
 * Calendar-date helpers. Due dates are plain local dates ("YYYY-MM-DD"), so all
 * arithmetic is done on UTC-midnight values to stay clear of DST shifts.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True for a real calendar date in "YYYY-MM-DD" form (rejects 2025-02-30). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** The user's local calendar date for the given instant. */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  const dt = new Date(toUtcMs(date) + days * DAY_MS);
  return dt.toISOString().slice(0, 10);
}

/** "Mon, Oct 20" — or with the year when it differs from `today`. */
export function formatDate(date: string, today: string): string {
  const dt = new Date(toUtcMs(date));
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return dt.toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
