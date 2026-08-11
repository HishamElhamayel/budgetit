/**
 * The data access contract.
 *
 * Every screen talks to this interface and nothing else — no screen imports the
 * Supabase client directly. That boundary is what let the original SQLite
 * implementation be swapped for `supabase-repository.ts` without a single
 * screen changing, and it is what would let an offline-first implementation
 * (writing locally first, syncing in the background) slot in later as a third.
 * Resist the urge to leak query builders or row shapes past this boundary.
 */

import type {
  Budget,
  BudgetCycle,
  BudgetProgress,
  Category,
  CategoryTotal,
  Expense,
  ExpenseDetail,
  Income,
  IncomeDetail,
  MonthFlow,
  Preferences,
  Profile,
} from '@/db/types';

export interface ExpenseQuery {
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
  budgetId?: string;
  categoryId?: string;
  /** Case-insensitive substring match on the description. */
  search?: string;
  limit?: number;
}

export interface BudgetInput {
  name: string;
  limitMinor: number | null;
  cycle: BudgetCycle;
  colorSlot: number;
}

export interface CategoryInput {
  name: string;
  icon: string;
  colorSlot: number;
}

export interface ExpenseInput {
  budgetId: string;
  categoryId: string | null;
  amountMinor: number;
  description: string | null;
  spentOn: string;
}

export interface IncomeInput {
  /** Optional: income can arrive without belonging to a single pot. */
  budgetId: string | null;
  amountMinor: number;
  source: string | null;
  receivedOn: string;
}

/**
 * The editable half of a profile. Email and password are absent on purpose —
 * they live in `auth.users`, not in a table this repository can reach, and they
 * go through `useAuth` instead.
 */
export interface ProfileInput {
  /** Null clears it. Trimmed by the implementation; blank becomes null. */
  fullName: string | null;
  /** ISO 3166-1 alpha-2. Null clears it. */
  countryCode: string | null;
}

export interface IncomeQuery {
  from?: string;
  to?: string;
  budgetId?: string;
  /**
   * Case-insensitive substring match on the source — income's counterpart to
   * an expense's description, so one search box over the ledger can hit both.
   */
  search?: string;
  limit?: number;
}

/** What the daily reminder needs to write a body worth reading. */
export interface DaySummary {
  dayKey: string;
  expenseCount: number;
  totalMinor: number;
  /** The budget with the least headroom left in its current cycle, if any. */
  tightestBudget: { name: string; remainingMinor: number } | null;
}

export interface Repository {
  listBudgets(): Promise<Budget[]>;
  createBudget(input: BudgetInput): Promise<Budget>;
  updateBudget(id: string, input: Partial<BudgetInput>): Promise<void>;
  deleteBudget(id: string): Promise<void>;

  listCategories(): Promise<Category[]>;
  createCategory(input: CategoryInput): Promise<Category>;
  updateCategory(id: string, input: Partial<CategoryInput>): Promise<void>;
  deleteCategory(id: string): Promise<void>;

  getExpense(id: string): Promise<ExpenseDetail | null>;
  listExpenses(query: ExpenseQuery): Promise<ExpenseDetail[]>;
  createExpense(input: ExpenseInput): Promise<Expense>;
  updateExpense(id: string, input: Partial<ExpenseInput>): Promise<void>;
  deleteExpense(id: string): Promise<void>;

  getIncome(id: string): Promise<IncomeDetail | null>;
  listIncomes(query: IncomeQuery): Promise<IncomeDetail[]>;
  createIncome(input: IncomeInput): Promise<Income>;
  updateIncome(id: string, input: Partial<IncomeInput>): Promise<void>;
  deleteIncome(id: string): Promise<void>;

  /**
   * Money in, money out and the difference over an inclusive day range, plus
   * the balance carried in from everything before `from`.
   */
  monthFlow(from: string, to: string): Promise<MonthFlow>;

  /** Spend by category for the donut, largest first. */
  categoryTotals(query: ExpenseQuery): Promise<CategoryTotal[]>;
  /** Spend against limit for each budget's current cycle. */
  budgetProgress(onDay: string): Promise<BudgetProgress[]>;
  /** Total spend per day across a range, for the trend line. Sparse. */
  dailyTotals(query: ExpenseQuery): Promise<{ dayKey: string; totalMinor: number }[]>;

  /**
   * The category last used in this budget — the default that saves the user a
   * tap on the second field, which is the one they don't have a ready answer
   * for. Null when the budget has no categorised history.
   */
  lastCategoryForBudget(budgetId: string): Promise<string | null>;

  daySummary(dayKey: string): Promise<DaySummary>;

  /**
   * The signed-in user's profile. Never null: a row is created by a trigger at
   * signup, and this recreates one if it is somehow missing, so callers get a
   * profile with empty fields rather than having to handle its absence.
   */
  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<ProfileInput>): Promise<void>;

  getPreferences(): Promise<Preferences>;
  setPreferences(patch: Partial<Preferences>): Promise<void>;

  /**
   * Wipe everything and return to a first-run state, seeded categories and all.
   *
   * Rows are hard-deleted rather than tombstoned: a reset means "this data
   * never happened", and soft-deleting would push a pile of tombstones to
   * Supabase on first sync and resurrect nothing useful.
   */
  resetAllData(): Promise<void>;
}
