/**
 * Supabase implementation of {@link Repository}.
 *
 * Swap-in replacement for the SQLite one: same interface, so no screen changed.
 * Three things are worth knowing before editing it.
 *
 * **Reads don't filter by user.** Row level security already restricts every
 * table to `auth.uid()`, and adding `.eq('user_id', userId)` on top would be a
 * second copy of the rule that can drift from the first. Writes *do* carry the
 * id, because a row has to be stamped with an owner to satisfy the policy's
 * `with check`.
 *
 * **Aggregates are computed here, not in Postgres.** PostgREST has no GROUP BY,
 * so the choices are a hand-written RPC per rollup or summing the rows in JS.
 * This takes the second, matching the deliberate brute force in `store.tsx`:
 * a year of daily logging is a few thousand rows, and one round trip that
 * over-fetches beats six that each need their filter logic kept in sync with
 * `expenseFilter`. If profiling ever says otherwise, these are the functions to
 * move server-side — the interface won't change.
 *
 * The exception is `monthFlow`, whose opening balance spans all history rather
 * than one bounded month. That is the one range big enough to meet PostgREST's
 * row cap, where over-fetching stops being merely wasteful and starts being
 * wrong, so it sums in Postgres via the `month_flow` RPC.
 *
 * **Soft deletes stay soft.** Every read filters `deleted_at IS NULL`, and
 * `delete*` writes a tombstone, so another device can learn a row went away
 * rather than silently resurrecting it.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type {
  BudgetInput,
  CategoryInput,
  DaySummary,
  ExpenseInput,
  ExpenseQuery,
  IncomeInput,
  IncomeQuery,
  ProfileInput,
  Repository,
} from '@/data/repository';
import { newId, nowIso } from '@/db/ids';
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
import { clampPeriodStartDay, cycleRange, daysBetween, DefaultPeriodStartDay, today } from '@/lib/date';

const DEFAULT_PREFERENCES: Preferences = {
  reminderEnabled: false,
  reminderMinuteOfDay: 20 * 60, // 8:00pm — after most spending, before bed.
  onboardingCompletedAt: null,
  currencyCode: 'USD',
  periodStartDay: DefaultPeriodStartDay,
};

/** Default cap on list reads, matching the SQLite repository. */
const DEFAULT_LIMIT = 500;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** An embedded budget, as returned by the `budget:budgets(...)` select. */
interface BudgetEmbed {
  name: string;
  color_slot: number;
}

interface CategoryEmbed {
  name: string;
  icon: string;
  color_slot: number;
}

interface BudgetRow {
  id: string;
  user_id: string;
  name: string;
  limit_minor: number | string | null;
  cycle: string;
  /** Optional: absent entirely until the reset_day migration is applied. */
  reset_day?: number | null;
  color_slot: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color_slot: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ExpenseRow {
  id: string;
  user_id: string;
  budget_id: string;
  category_id: string | null;
  amount_minor: number | string;
  description: string | null;
  spent_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ExpenseDetailRow extends ExpenseRow {
  budget: BudgetEmbed | null;
  category: CategoryEmbed | null;
}

interface IncomeRow {
  id: string;
  user_id: string;
  budget_id: string | null;
  amount_minor: number | string;
  source: string | null;
  received_on: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface IncomeDetailRow extends IncomeRow {
  budget: BudgetEmbed | null;
}

/** The one row returned by the `month_flow` RPC. */
interface MonthFlowRow {
  opening_minor: number | string;
  in_minor: number | string;
  out_minor: number | string;
}

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  country_code: string | null;
  created_at: string;
  updated_at: string;
}

// Embeds are aliased so the mapped shape reads like the domain object rather
// than like a join. The relationship is unambiguous — one foreign key from each
// side — so PostgREST needs no explicit constraint hint.
const EXPENSE_DETAIL_SELECT =
  '*, budget:budgets(name, color_slot), category:categories(name, icon, color_slot)';

const INCOME_DETAIL_SELECT = '*, budget:budgets(name, color_slot)';

// The donut needs the category's display fields alongside each amount, but none
// of the expense's own columns beyond the grouping key.
const CATEGORY_TOTAL_SELECT =
  'category_id, amount_minor, category:categories(name, icon, color_slot)';

/**
 * Money arrives as a JSON number from `bigint` columns on most deployments and
 * as a string on some, depending on how PostgREST is configured to protect
 * against precision loss. Coercing once here means the rest of the app never
 * has to care which.
 */
function minor(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function nullableMinor(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : minor(value);
}

function toProfile(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    countryCode: row.country_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Free text on its way to a nullable column.
 *
 * A field the user emptied arrives as `''`, and storing that would make "has no
 * name" and "is called nothing" two different states that render identically.
 * Collapsing to null here means every reader can ask one question.
 */
function textOrNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    limitMinor: nullableMinor(row.limit_minor),
    cycle: row.cycle as BudgetCycle,
    // Coerced rather than passed through: a client running against a database
    // that hasn't had the reset_day migration applied gets rows with no such
    // key at all, and `undefined` slips past the `=== null` checks that decide
    // whether a budget follows the app-wide period.
    resetDay: row.reset_day ?? null,
    colorSlot: row.color_slot,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    icon: row.icon,
    colorSlot: row.color_slot,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toExpenseDetail(row: ExpenseDetailRow): ExpenseDetail {
  return {
    id: row.id,
    userId: row.user_id,
    budgetId: row.budget_id,
    categoryId: row.category_id,
    amountMinor: minor(row.amount_minor),
    description: row.description,
    spentOn: row.spent_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    // The budget is NOT NULL and foreign-keyed, so the embed is only ever
    // absent if the select was changed. Falling back beats crashing a list.
    budgetName: row.budget?.name ?? '',
    budgetColorSlot: row.budget?.color_slot ?? 0,
    categoryName: row.category?.name ?? null,
    categoryIcon: row.category?.icon ?? null,
    categoryColorSlot: row.category?.color_slot ?? null,
  };
}

function toIncomeDetail(row: IncomeDetailRow): IncomeDetail {
  return {
    id: row.id,
    userId: row.user_id,
    budgetId: row.budget_id,
    amountMinor: minor(row.amount_minor),
    source: row.source,
    receivedOn: row.received_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    budgetName: row.budget?.name ?? null,
    budgetColorSlot: row.budget?.color_slot ?? null,
  };
}

/**
 * Unwrap a PostgREST response, turning its error channel into a thrown one.
 *
 * `useQuery` already catches and logs, and every mutation path has a form
 * around it, so a rejected promise lands somewhere useful. Returning
 * `{ data, error }` all the way up would push that branch into every screen.
 */
function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) {
    throw new Error(`[supabase] ${result.error.message}`, { cause: result.error });
  }
  // A non-error response with no data only happens on `maybeSingle`, whose
  // callers here handle null themselves before reaching this.
  return result.data as T;
}

export function createSupabaseRepository(client: SupabaseClient, userId: string): Repository {
  /**
   * Start an expense read with the shared filters already applied.
   *
   * Kept as one function for the same reason the SQLite version was: the list,
   * the donut and the trend line must agree on what counts as "in range", and
   * three copies of that is three chances to disagree.
   *
   * `select` is typed as plain `string` rather than a literal on purpose.
   * supabase-js parses select strings at the type level to derive the row
   * shape, and running an embedded select like EXPENSE_DETAIL_SELECT back
   * through that parser here tips it into "type instantiation is excessively
   * deep". Callers state the shape they expect with `.returns<T>()`, which is
   * where the row types above earn their keep.
   */
  function expenseQuery(select: string, query: ExpenseQuery) {
    let builder = client.from('expenses').select(select).is('deleted_at', null);

    if (query.from) builder = builder.gte('spent_on', query.from);
    if (query.to) builder = builder.lte('spent_on', query.to);
    if (query.budgetId) builder = builder.eq('budget_id', query.budgetId);
    if (query.categoryId) builder = builder.eq('category_id', query.categoryId);

    const search = query.search?.trim();
    if (search) builder = builder.ilike('description', `%${search}%`);

    return builder;
  }

  /** Next free `sort_order`, the equivalent of `MAX(sort_order) + 1`. */
  async function nextSortOrder(table: 'budgets' | 'categories'): Promise<number> {
    const { data, error } = await client
      .from(table)
      .select('sort_order')
      .is('deleted_at', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    return data ? data.sort_order + 1 : 0;
  }

  /** Strip undefined keys from a patch and stamp `updated_at`. */
  function patch(columns: Record<string, unknown>): Record<string, unknown> {
    const defined = Object.entries(columns).filter(([, value]) => value !== undefined);
    return { ...Object.fromEntries(defined), updated_at: nowIso() };
  }

  async function softDelete(
    table: 'budgets' | 'categories' | 'expenses' | 'incomes',
    id: string
  ): Promise<void> {
    const timestamp = nowIso();
    const { error } = await client
      .from(table)
      .update({ deleted_at: timestamp, updated_at: timestamp })
      .eq('id', id);
    if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
  }

  async function listBudgets(): Promise<Budget[]> {
    const rows = unwrap(
      await client
        .from('budgets')
        .select('*')
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .returns<BudgetRow[]>()
    );
    return rows.map(toBudget);
  }

  async function getPreferences(): Promise<Preferences> {
    const rows = unwrap(
      await client.from('preferences').select('key, value').returns<{ key: string; value: string }[]>()
    );
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    return {
      reminderEnabled: stored.reminderEnabled
        ? stored.reminderEnabled === 'true'
        : DEFAULT_PREFERENCES.reminderEnabled,
      reminderMinuteOfDay: stored.reminderMinuteOfDay
        ? Number(stored.reminderMinuteOfDay)
        : DEFAULT_PREFERENCES.reminderMinuteOfDay,
      // Stored as '' when cleared, so `||` rather than `??`.
      onboardingCompletedAt: stored.onboardingCompletedAt || null,
      currencyCode: stored.currencyCode ?? DEFAULT_PREFERENCES.currencyCode,
      // Clamped rather than trusted: this is a free-text value column, and a
      // junk or out-of-range day would silently shift every period boundary in
      // the app rather than fail anywhere the user could see it.
      periodStartDay: clampPeriodStartDay(
        stored.periodStartDay ? Number(stored.periodStartDay) : DEFAULT_PREFERENCES.periodStartDay
      ),
    };
  }

  async function budgetProgress(onDay: string): Promise<BudgetProgress[]> {
    // Preferences come along because a budget with a null `resetDay` follows
    // the app-wide period start. Fetched alongside the budgets rather than
    // after them, so resolving the fallback costs no extra round trip.
    const [budgets, preferences] = await Promise.all([listBudgets(), getPreferences()]);
    if (budgets.length === 0) return [];

    // Each budget has its own cycle, so each has its own range. Rather than one
    // request per budget — which is what the SQLite version did, cheaply, over
    // a local file — fetch the union of every range once and split it up here.
    // Over a network that is the difference between one round trip and N.
    const ranges = budgets.map((budget) =>
      cycleRange(onDay, budget.cycle, budget.resetDay ?? preferences.periodStartDay)
    );
    const from = ranges.reduce((min, range) => (range.start < min ? range.start : min), ranges[0].start);
    const to = ranges.reduce((max, range) => (range.end > max ? range.end : max), ranges[0].end);

    const rows = unwrap(
      await client
        .from('expenses')
        .select('budget_id, amount_minor, spent_on')
        .is('deleted_at', null)
        .gte('spent_on', from)
        .lte('spent_on', to)
        .returns<Pick<ExpenseRow, 'budget_id' | 'amount_minor' | 'spent_on'>[]>()
    );

    return budgets.map((budget, index) => {
      const { start, end } = ranges[index];
      const spentMinor = rows.reduce(
        (sum, row) =>
          row.budget_id === budget.id && row.spent_on >= start && row.spent_on <= end
            ? sum + minor(row.amount_minor)
            : sum,
        0
      );

      return {
        budget,
        spentMinor,
        cycleStart: start,
        cycleEnd: end,
        daysLeft: Math.max(0, daysBetween(onDay, end)),
      };
    });
  }

  return {
    listBudgets,
    budgetProgress,

    async createBudget(input: BudgetInput) {
      const timestamp = nowIso();
      const row = {
        id: newId(),
        user_id: userId,
        name: input.name,
        limit_minor: input.limitMinor,
        cycle: input.cycle,
        reset_day: input.resetDay,
        color_slot: input.colorSlot,
        sort_order: await nextSortOrder('budgets'),
        created_at: timestamp,
        updated_at: timestamp,
      };

      // `.select().single()` returns the row Postgres actually stored, so any
      // column default or check constraint is reflected in what callers get
      // back rather than in what we optimistically assumed.
      const created = unwrap(
        await client.from('budgets').insert(row).select('*').single<BudgetRow>()
      );
      return toBudget(created);
    },

    async updateBudget(id, input) {
      const { error } = await client
        .from('budgets')
        .update(
          patch({
            name: input.name,
            limit_minor: input.limitMinor,
            cycle: input.cycle,
            reset_day: input.resetDay,
            color_slot: input.colorSlot,
          })
        )
        .eq('id', id);
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },

    async deleteBudget(id) {
      // Expenses keep pointing at the tombstoned budget rather than cascading —
      // deleting an envelope should not silently erase the spending history
      // recorded against it. The embed in the detail selects has no
      // `deleted_at` filter for exactly this reason.
      await softDelete('budgets', id);
    },

    async listCategories() {
      const rows = unwrap(
        await client
          .from('categories')
          .select('*')
          .is('deleted_at', null)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .returns<CategoryRow[]>()
      );
      return rows.map(toCategory);
    },

    async createCategory(input: CategoryInput) {
      const timestamp = nowIso();
      const row = {
        id: newId(),
        user_id: userId,
        name: input.name,
        icon: input.icon,
        color_slot: input.colorSlot,
        sort_order: await nextSortOrder('categories'),
        created_at: timestamp,
        updated_at: timestamp,
      };

      const created = unwrap(
        await client.from('categories').insert(row).select('*').single<CategoryRow>()
      );
      return toCategory(created);
    },

    async updateCategory(id, input) {
      const { error } = await client
        .from('categories')
        .update(patch({ name: input.name, icon: input.icon, color_slot: input.colorSlot }))
        .eq('id', id);
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },

    async deleteCategory(id) {
      await softDelete('categories', id);
    },

    async getExpense(id) {
      const { data, error } = await client
        .from('expenses')
        .select(EXPENSE_DETAIL_SELECT)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle<ExpenseDetailRow>();

      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
      return data ? toExpenseDetail(data) : null;
    },

    async listExpenses(query) {
      const rows = unwrap(
        await expenseQuery(EXPENSE_DETAIL_SELECT, query)
          .order('spent_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(query.limit ?? DEFAULT_LIMIT)
          .returns<ExpenseDetailRow[]>()
      );
      return rows.map(toExpenseDetail);
    },

    async createExpense(input: ExpenseInput) {
      const timestamp = nowIso();
      const row = {
        id: newId(),
        user_id: userId,
        budget_id: input.budgetId,
        category_id: input.categoryId,
        amount_minor: input.amountMinor,
        description: input.description,
        spent_on: input.spentOn,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const created = unwrap(
        await client.from('expenses').insert(row).select('*').single<ExpenseRow>()
      );

      const expense: Expense = {
        id: created.id,
        userId: created.user_id,
        budgetId: created.budget_id,
        categoryId: created.category_id,
        amountMinor: minor(created.amount_minor),
        description: created.description,
        spentOn: created.spent_on,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
        deletedAt: created.deleted_at,
      };
      return expense;
    },

    async updateExpense(id, input) {
      const { error } = await client
        .from('expenses')
        .update(
          patch({
            budget_id: input.budgetId,
            category_id: input.categoryId,
            amount_minor: input.amountMinor,
            description: input.description,
            spent_on: input.spentOn,
          })
        )
        .eq('id', id);
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },

    async deleteExpense(id) {
      await softDelete('expenses', id);
    },

    async getIncome(id) {
      const { data, error } = await client
        .from('incomes')
        .select(INCOME_DETAIL_SELECT)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle<IncomeDetailRow>();

      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
      return data ? toIncomeDetail(data) : null;
    },

    async listIncomes(query: IncomeQuery) {
      let builder = client.from('incomes').select(INCOME_DETAIL_SELECT).is('deleted_at', null);
      if (query.from) builder = builder.gte('received_on', query.from);
      if (query.to) builder = builder.lte('received_on', query.to);
      if (query.budgetId) builder = builder.eq('budget_id', query.budgetId);

      const search = query.search?.trim();
      if (search) builder = builder.ilike('source', `%${search}%`);

      const rows = unwrap(
        await builder
          .order('received_on', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(query.limit ?? DEFAULT_LIMIT)
          .returns<IncomeDetailRow[]>()
      );
      return rows.map(toIncomeDetail);
    },

    async createIncome(input: IncomeInput) {
      const timestamp = nowIso();
      const row = {
        id: newId(),
        user_id: userId,
        budget_id: input.budgetId,
        amount_minor: input.amountMinor,
        source: input.source,
        received_on: input.receivedOn,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const created = unwrap(
        await client.from('incomes').insert(row).select('*').single<IncomeRow>()
      );

      const income: Income = {
        id: created.id,
        userId: created.user_id,
        budgetId: created.budget_id,
        amountMinor: minor(created.amount_minor),
        source: created.source,
        receivedOn: created.received_on,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
        deletedAt: created.deleted_at,
      };
      return income;
    },

    async updateIncome(id, input) {
      const { error } = await client
        .from('incomes')
        .update(
          patch({
            budget_id: input.budgetId,
            amount_minor: input.amountMinor,
            source: input.source,
            received_on: input.receivedOn,
          })
        )
        .eq('id', id);
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },

    async deleteIncome(id) {
      await softDelete('incomes', id);
    },

    async monthFlow(from, to): Promise<MonthFlow> {
      // The one rollup that is *not* summed here, against the rule at the top of
      // this file. The opening balance spans all history rather than one month,
      // so fetching its rows to reduce them is the query that eventually meets
      // PostgREST's row cap — and a truncated response would not throw, it would
      // report a plausible wrong balance. See the `month_flow` migration.
      const row = unwrap(
        await client.rpc('month_flow', { from_day: from, to_day: to }).single<MonthFlowRow>()
      );

      const openingMinor = minor(row.opening_minor);
      const inMinor = minor(row.in_minor);
      const outMinor = minor(row.out_minor);

      return {
        inMinor,
        outMinor,
        netMinor: inMinor - outMinor,
        openingMinor,
        availableMinor: openingMinor + inMinor - outMinor,
      };
    },

    async categoryTotals(query) {
      const rows = unwrap(
        await expenseQuery(CATEGORY_TOTAL_SELECT, query).returns<
          Pick<ExpenseDetailRow, 'category_id' | 'amount_minor' | 'category'>[]
        >()
      );

      // Keyed by category id, with a sentinel for the uncategorised bucket
      // because `null` is not a usable Map key alongside real ids.
      const buckets = new Map<string, CategoryTotal>();

      for (const row of rows) {
        const key = row.category_id ?? ' uncategorised';
        const existing = buckets.get(key);

        if (existing) {
          existing.totalMinor += minor(row.amount_minor);
          continue;
        }

        buckets.set(key, {
          categoryId: row.category_id,
          name: row.category?.name ?? 'Uncategorised',
          icon: row.category?.icon ?? null,
          // Null for the uncategorised bucket, which renders in muted ink.
          colorSlot: row.category_id ? (row.category?.color_slot ?? null) : null,
          totalMinor: minor(row.amount_minor),
        });
      }

      return [...buckets.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    },

    async dailyTotals(query) {
      const rows = unwrap(
        await expenseQuery('spent_on, amount_minor', query).returns<
          Pick<ExpenseRow, 'spent_on' | 'amount_minor'>[]
        >()
      );

      const byDay = new Map<string, number>();
      for (const row of rows) {
        byDay.set(row.spent_on, (byDay.get(row.spent_on) ?? 0) + minor(row.amount_minor));
      }

      // Sparse and ascending, the same contract the trend line already expects.
      return [...byDay.entries()]
        .map(([dayKey, totalMinor]) => ({ dayKey, totalMinor }))
        .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    },

    async lastCategoryForBudget(budgetId) {
      const { data, error } = await client
        .from('expenses')
        .select('category_id')
        .is('deleted_at', null)
        .eq('budget_id', budgetId)
        .not('category_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ category_id: string }>();

      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
      return data?.category_id ?? null;
    },

    async daySummary(dayKey): Promise<DaySummary> {
      const [expenses, progress] = await Promise.all([
        client
          .from('expenses')
          .select('amount_minor')
          .is('deleted_at', null)
          .eq('spent_on', dayKey)
          .returns<{ amount_minor: number | string }[]>(),
        budgetProgress(dayKey),
      ]);

      const rows = unwrap(expenses);
      const capped = progress.filter((entry) => entry.budget.limitMinor !== null);

      const tightest = capped.reduce<BudgetProgress | null>((worst, entry) => {
        if (!worst) return entry;
        const remaining = entry.budget.limitMinor! - entry.spentMinor;
        const worstRemaining = worst.budget.limitMinor! - worst.spentMinor;
        return remaining < worstRemaining ? entry : worst;
      }, null);

      return {
        dayKey,
        expenseCount: rows.length,
        totalMinor: rows.reduce((sum, row) => sum + minor(row.amount_minor), 0),
        tightestBudget: tightest
          ? {
              name: tightest.budget.name,
              remainingMinor: tightest.budget.limitMinor! - tightest.spentMinor,
            }
          : null,
      };
    },

    async getProfile(): Promise<Profile> {
      // No `.eq('user_id', ...)`, for the reason at the top of this file: RLS
      // already limits the table to one visible row, and `maybeSingle` would
      // complain loudly if that ever stopped being true.
      const { data, error } = await client.from('profiles').select('*').maybeSingle<ProfileRow>();
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
      if (data) return toProfile(data);

      // The signup trigger creates this row, so getting here means it didn't
      // run — an account made before the profiles migration and somehow missed
      // by its backfill, or one created straight through the admin API.
      // Repairing it is cheaper for everyone than making every caller handle a
      // null profile it will otherwise never see.
      const created = unwrap(
        await client.from('profiles').insert({ user_id: userId }).select('*').single<ProfileRow>()
      );
      return toProfile(created);
    },

    async updateProfile(input: Partial<ProfileInput>) {
      const { error } = await client
        .from('profiles')
        .update(
          patch({
            // `undefined` means "not in this patch" and must survive as such;
            // only a value that is actually present gets normalised.
            full_name: input.fullName === undefined ? undefined : textOrNull(input.fullName),
            country_code:
              input.countryCode === undefined
                ? undefined
                : textOrNull(input.countryCode)?.toUpperCase() ?? null,
          })
        )
        .eq('user_id', userId);
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },

    getPreferences,

    async setPreferences(update) {
      const rows = Object.entries(update)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
          user_id: userId,
          key,
          value: value === null ? '' : String(value),
        }));

      if (rows.length === 0) return;

      // One upsert for the whole patch rather than a request per key. The
      // conflict target is the composite primary key, so an existing key is
      // overwritten and a new one inserted without a read first.
      const { error } = await client
        .from('preferences')
        .upsert(rows, { onConflict: 'user_id,key' });
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },

    async resetAllData() {
      // A single RPC, so the wipe and the reseed share a transaction. Doing it
      // client-side would be six round trips with no way to roll back a failure
      // halfway through. See `reset_all_data` in the initial migration.
      const { error } = await client.rpc('reset_all_data');
      if (error) throw new Error(`[supabase] ${error.message}`, { cause: error });
    },
  };
}

export { DEFAULT_PREFERENCES, today };
