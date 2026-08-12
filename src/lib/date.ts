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

/**
 * Where a monthly period begins when nobody has said otherwise — the 1st, i.e.
 * the calendar month, which is what this app did before pay cycles existed.
 */
export const DefaultPeriodStartDay = 1;

/** Coerce anything read out of storage or a text field into a usable 1–31. */
export function clampPeriodStartDay(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DefaultPeriodStartDay;
  return Math.min(31, Math.max(1, Math.trunc(value)));
}

/**
 * The day `startDay` lands on in a given month, pulled back to the last day
 * when that month is too short.
 *
 * Clamping rather than spilling into the next month is what keeps periods
 * tiling the calendar with no gaps and no overlaps: a start day of the 31st
 * anchors 28 Feb, and because the clamp is monotonic the period that began on
 * 31 Jan simply ends on 27 Feb. Spilling to 3 Mar would leave 28 Feb – 2 Mar
 * belonging to two periods at once.
 */
function monthAnchor(year: number, monthIndex: number, startDay: number): string {
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return toDayKey(new Date(year, monthIndex, Math.min(startDay, lastDay)));
}

/**
 * Inclusive [start, end] of the budget period that `key` falls inside.
 *
 * With `startDay` at 1 this is exactly the calendar month; with it at 25 it is
 * the 25th to the 24th, which is what someone paid before month end actually
 * budgets against.
 */
export function periodRange(key: string, startDay: number): { start: string; end: string } {
  const day = clampPeriodStartDay(startDay);
  const date = fromDayKey(key);
  const year = date.getFullYear();
  const month = date.getMonth();

  const thisMonth = monthAnchor(year, month, day);
  // Before this month's anchor, the period running through `key` opened in the
  // previous month.
  const start = key >= thisMonth ? thisMonth : monthAnchor(year, month - 1, day);
  const next = key >= thisMonth ? monthAnchor(year, month + 1, day) : thisMonth;

  return { start, end: addDays(next, -1) };
}

/** Step `delta` whole periods from the one containing `key`. */
export function addPeriods(key: string, startDay: number, delta: number): string {
  const { start, end } = periodRange(key, startDay);
  // Landing one day outside the current period and re-deriving keeps the walk
  // correct across the clamped months, where periods are not the same length.
  return delta < 0
    ? periodRange(addDays(start, -1), startDay).start
    : delta > 0
      ? addDays(end, 1)
      : start;
}

/** Inclusive [start, end] of the cycle that `key` falls inside. */
export function cycleRange(
  key: string,
  cycle: BudgetCycle,
  startDay: number = DefaultPeriodStartDay
): { start: string; end: string } {
  if (cycle === 'weekly') {
    const start = startOfWeek(key);
    return { start, end: addDays(start, 6) };
  }
  return periodRange(key, startDay);
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

/**
 * What to call a budget period: "August" when it *is* a calendar month, and
 * "25 Jul – 24 Aug" when it isn't.
 *
 * Naming the month wherever one applies matters more than consistency of shape.
 * A user on the default start day should never see their period spelled out as
 * a range — that would be the app explaining a feature they haven't turned on.
 */
export function formatPeriodLabel(start: string, end: string): string {
  if (start === startOfMonth(start) && end === endOfMonth(start)) {
    return formatMonthLabel(start.slice(0, 7));
  }

  const reference = today();
  const sameYear =
    start.slice(0, 4) === reference.slice(0, 4) && end.slice(0, 4) === reference.slice(0, 4);
  const edge = (key: string) =>
    fromDayKey(key).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    });

  return `${edge(start)} – ${edge(end)}`;
}

/** "1st" / "22nd" / "3rd" — for naming a start day in settings copy. */
export function formatOrdinalDay(day: number): string {
  // 11th–13th break the pattern the last digit otherwise sets.
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
  return `${day}${suffix}`;
}

export function formatTimeOfDay(minuteOfDay: number): string {
  const date = new Date();
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
