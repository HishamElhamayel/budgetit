/**
 * Local-calendar date helpers.
 *
 * Expense dates are stored as `YYYY-MM-DD` strings rather than timestamps, so
 * that "what did I spend today" is a string comparison in SQL and never shifts
 * under the user when their timezone changes. Every function here works in the
 * device's local timezone on purpose — `toISOString()` is deliberately avoided
 * because it converts to UTC and rolls the date over for anyone west of GMT.
 */

import type { BudgetCycle } from '@/db/types';

/** `YYYY-MM-DD` in local time. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toDayKey(new Date());
}

/** `YYYY-MM` — the prefix used to filter a month with `LIKE`/`>=`. */
export function toMonthKey(date: Date): string {
  return toDayKey(date).slice(0, 7);
}

export function addDays(key: string, days: number): string {
  const date = fromDayKey(key);
  date.setDate(date.getDate() + days);
  return toDayKey(date);
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: string): string {
  const date = fromDayKey(key);
  // Day 0 of next month is the last day of this one.
  return toDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/** Weeks start Monday. */
export function startOfWeek(key: string): string {
  const date = fromDayKey(key);
  const offset = (date.getDay() + 6) % 7;
  return addDays(key, -offset);
}

/** Inclusive [start, end] of the cycle that `key` falls inside. */
export function cycleRange(key: string, cycle: BudgetCycle): { start: string; end: string } {
  if (cycle === 'weekly') {
    const start = startOfWeek(key);
    return { start, end: addDays(start, 6) };
  }
  return { start: startOfMonth(key), end: endOfMonth(key) };
}

export function daysBetween(from: string, to: string): number {
  const ms = fromDayKey(to).getTime() - fromDayKey(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** "Today" / "Yesterday" / "Mar 4" / "Mar 4, 2025" for list headers and chips. */
export function formatDayLabel(key: string, reference: string = today()): string {
  if (key === reference) return 'Today';
  if (key === addDays(reference, -1)) return 'Yesterday';

  const date = fromDayKey(key);
  const sameYear = key.slice(0, 4) === reference.slice(0, 4);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

export function formatMonthLabel(monthKey: string): string {
  const date = fromDayKey(`${monthKey}-01`);
  const sameYear = monthKey.slice(0, 4) === today().slice(0, 4);
  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const date = new Date();
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
