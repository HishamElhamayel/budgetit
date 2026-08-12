/**
 * Domain types.
 *
 * Two conventions here exist to make the eventual move to Supabase a data copy
 * rather than a rewrite:
 *
 * - **Ids are client-generated UUIDs**, not autoincrementing integers, so rows
 *   created offline never collide with rows created on another device.
 * - **Money is an integer count of minor units** (cents), never a float. SQLite
 *   REAL and JS numbers both drift on decimal arithmetic; a sum of 100 expenses
 *   should not land on 249.99999999997.
 *
 * Dates come in two flavours and the distinction matters:
 * - `spentOn` is a local calendar day (`YYYY-MM-DD`). It is the day the user
 *   says they spent the money, and it must not shift when they fly to Tokyo.
 * - `createdAt` / `updatedAt` / `deletedAt` are UTC ISO-8601 instants, used for
 *   sync ordering.
 */

export type BudgetCycle = 'weekly' | 'monthly';

/** Fields every syncable row carries. */
export interface SyncFields {
  /** Null until the user signs in; Supabase RLS will key off this. */
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete tombstone. Non-null rows are filtered out of every read. */
  deletedAt: string | null;
}

/** An envelope: a pot of money with an optional limit and a reset cycle. */
export interface Budget extends SyncFields {
  id: string;
  name: string;
  /** Minor units. Null means "track spending here, but don't cap it". */
  limitMinor: number | null;
  cycle: BudgetCycle;
  /**
   * Day of the month a `monthly` cycle restarts on, 1–31. Ignored by `weekly`.
   *
   * Null means "follow {@link Preferences.periodStartDay}" rather than "the
   * 1st", so moving payday is one edit in settings instead of one per budget.
   * A budget that genuinely differs — rent, due on the 1st whatever the salary
   * does — pins its own day and stops tracking the app-wide one.
   */
  resetDay: number | null;
  /** Palette slot index, resolved to a hex per colour scheme at render time. */
  colorSlot: number;
  sortOrder: number;
}

/** What the money was spent on, independent of which envelope paid for it. */
export interface Category extends SyncFields {
  id: string;
  name: string;
  /** SF Symbol / Material Symbol name. */
  icon: string;
  colorSlot: number;
  sortOrder: number;
}

export interface Expense extends SyncFields {
  id: string;
  budgetId: string;
  /** Nullable: an expense can be logged before the user decides on a category. */
  categoryId: string | null;
  amountMinor: number;
  description: string | null;
  /** Local calendar day, `YYYY-MM-DD`. */
  spentOn: string;
}

/**
 * Money coming in.
 *
 * Deliberately *not* wired into budget limits: a budget's limit is a cap the
 * user chose, and income is a record of what arrived. Tagging an income with a
 * budget answers "which pot did this paycheck fill" without silently turning
 * the limit into a derived allocation.
 */
export interface Income extends SyncFields {
  id: string;
  /** Optional — income doesn't have to belong to any single pot. */
  budgetId: string | null;
  amountMinor: number;
  /** Where it came from: "Salary", "Refund", "Side project". */
  source: string | null;
  /** Local calendar day, `YYYY-MM-DD`. */
  receivedOn: string;
}

export interface IncomeDetail extends Income {
  budgetName: string | null;
  budgetColorSlot: number | null;
}

/**
 * Money in vs money out over a period, and the balance carried into it.
 *
 * `netMinor` answers "did this month pay for itself"; `availableMinor` answers
 * "how much do I actually have". They differ by whatever was left over from
 * every month before this one, which does not evaporate at midnight on the 1st.
 *
 * `openingMinor` is derived from the whole history on every read rather than
 * snapshotted at the month boundary, because expenses can be logged into a
 * month that has already closed — a receipt entered late has to correct every
 * month after it, not just the one it belongs to.
 */
export interface MonthFlow {
  inMinor: number;
  outMinor: number;
  netMinor: number;
  /**
   * Everything earned before the period less everything spent before it.
   * Negative when past months were overspent — a deficit rolls forward for the
   * same reason a surplus does.
   */
  openingMinor: number;
  /** `openingMinor + inMinor - outMinor`. The running balance. */
  availableMinor: number;
}

/** An expense joined with the display fields of its budget and category. */
export interface ExpenseDetail extends Expense {
  budgetName: string;
  budgetColorSlot: number;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColorSlot: number | null;
}

/**
 * One line in the ledger — money out or money in.
 *
 * A tagged union rather than a common base type, because the two halves
 * genuinely differ in ways a list has to care about: an expense always belongs
 * to a budget and may name a category, income does neither, and their day
 * fields are `spentOn` and `receivedOn`. Flattening those into shared nullable
 * columns would let a row render as an expense with no budget, which is a state
 * the database cannot produce. Narrowing on `kind` keeps that impossible.
 */
export type ActivityEntry =
  | ({ kind: 'expense' } & ExpenseDetail)
  | ({ kind: 'income' } & IncomeDetail);

/** One slice of the "where did it go" donut. */
export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  icon: string | null;
  /** Null for the uncategorised bucket, which renders in muted ink. */
  colorSlot: number | null;
  totalMinor: number;
}

/** One row of the budget progress bars: spend against limit for a cycle. */
export interface BudgetProgress {
  budget: Budget;
  spentMinor: number;
  /** Inclusive start / end of the budget's current cycle, `YYYY-MM-DD`. */
  cycleStart: string;
  cycleEnd: string;
  daysLeft: number;
}

/**
 * Who the account belongs to.
 *
 * Deliberately not a {@link SyncFields} row: there is exactly one per account,
 * it is keyed on the user rather than on a generated id, and it cannot be
 * deleted while the account exists — so a tombstone would never be anything but
 * null. Both fields are nullable because an account can predate ever being
 * asked (see the backfill in the profiles migration).
 */
export interface Profile {
  userId: string;
  fullName: string | null;
  /** ISO 3166-1 alpha-2, as listed in constants/countries.ts. */
  countryCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Key/value app settings. Kept out of the sync tables deliberately. */
export interface Preferences {
  reminderEnabled: boolean;
  /** Minutes past local midnight, e.g. 20 * 60 + 30 for 8:30pm. */
  reminderMinuteOfDay: number;
  onboardingCompletedAt: string | null;
  currencyCode: string;
  /**
   * Day of the month every budget period starts on, 1–31. 1 is the calendar
   * month; 25 is "my salary lands on the 25th, so that is when the month
   * starts as far as my money is concerned".
   *
   * App-wide rather than per-budget because the ledger views — Home's in/out
   * card and the Activity list — have no budget to take a period from, and a
   * "left this period" that meant a different span on each screen would be
   * worse than no setting at all.
   */
  periodStartDay: number;
}
