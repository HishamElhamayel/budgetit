-- budgetit — put a ceiling on what a client may write, and make a reference to
-- another user's row impossible rather than merely useless.
--
-- Both halves close the same kind of gap: a rule the app already follows, which
-- the database was never told about. Row level security decides *whose* rows a
-- request may touch and has been right from the start. It says nothing about
-- what may be put in them, and PostgREST is a public endpoint — the app is one
-- client of this schema, not its gatekeeper.

-- ---------------------------------------------------------------------------
-- Length and range bounds
-- ---------------------------------------------------------------------------
--
-- `profiles.full_name` has had a bound since the profiles migration, for a
-- reason stated there that applies just as well to every column below: it
-- exists "so a runaway paste can't put a megabyte of text behind a greeting".
-- The older tables never got the same treatment, so `budgets.name`,
-- `categories.name`, `expenses.description`, `incomes.source` and both halves
-- of `preferences` were unbounded `text` — and Postgres will hold just under a
-- gigabyte in one of those.
--
-- What that costs is not a leak. RLS still confines every write to the writer's
-- own rows, so the worst case is an account inflating its own storage. It is
-- billing and availability rather than confidentiality, and the account's own
-- client suffers first: `budgets` and `categories` are read in full on every
-- app load (see `load` in src/data/store.tsx), so an oversized name is dragged
-- down the wire on every cold start.
--
-- The numbers are ceilings, not validation. Nothing real reaches them; they are
-- picked to be obviously beyond legitimate use so that meeting one is evidence
-- of something other than typing. The matching `maxLength` props on the inputs
-- are what a person actually encounters — these are what an HTTP client does.

alter table public.budgets
  add constraint budgets_name_length check (char_length(name) <= 80);

alter table public.categories
  add constraint categories_name_length check (char_length(name) <= 80);

alter table public.expenses
  add constraint expenses_description_length check (char_length(description) <= 500);

alter table public.incomes
  add constraint incomes_source_length check (char_length(source) <= 200);

-- Money. Two separate concerns in one constraint each.
--
-- The lower bound is `>= 0`, not `> 0`, even though `parseAmountToMinor` in
-- src/lib/money.ts rejects zero and the forms cannot submit it. The thing worth
-- excluding is a *negative* amount, which would not be a large expense — it
-- would silently invert every rollup that sums these columns, including the
-- opening balance in `month_flow`, where a negative expense reads as income.
-- Zero is merely useless, and `month_flow` already carries `direction`
-- explicitly so that a zero-amount row still lands in the right bucket. Barring
-- it here would add a way for this migration to fail on real data in exchange
-- for nothing.
--
-- The upper bound is 10^15 minor units — ten trillion major units, so far past
-- any budget that reaching it is not a large number, it is a probe. Well inside
-- bigint, so the column itself never overflows.
alter table public.expenses
  add constraint expenses_amount_range check (amount_minor >= 0 and amount_minor <= 1000000000000000);

alter table public.incomes
  add constraint incomes_amount_range check (amount_minor >= 0 and amount_minor <= 1000000000000000);

-- `preferences` is the one table where the row *count* is attacker-controlled
-- too: the primary key is (user_id, key), and `key` was any text at all, so an
-- account could open an unbounded number of rows in it. Pinning the set closes
-- that without a counter to maintain.
--
-- The cost is real and worth stating: adding a preference now means a migration
-- as well as a field on `Preferences`. That is the intended trade — it is five
-- keys that have changed twice, and the failure mode is a loud error in
-- development rather than a quiet table growing in production. Keep this list
-- equal to the keys of `Preferences` in src/db/types.ts.
alter table public.preferences
  add constraint preferences_known_key check (
    key in (
      'reminderEnabled',
      'reminderMinuteOfDay',
      'onboardingCompletedAt',
      'currencyCode',
      'periodStartDay'
    )
  ),
  add constraint preferences_value_length check (char_length(value) <= 200);

-- ---------------------------------------------------------------------------
-- Same-owner foreign keys
-- ---------------------------------------------------------------------------
--
-- `expenses.budget_id` referenced `budgets (id)` and nothing more, so nothing
-- stopped a row owned by one user pointing at a budget owned by another.
-- The RLS `with check` does not catch it: it asks whether `expenses.user_id` is
-- the caller, which it is. And foreign keys are enforced by a system trigger
-- that runs *outside* RLS, so the reference resolves against rows the caller
-- cannot see — the insert succeeds.
--
-- Nothing leaks as a result. The embed in EXPENSE_DETAIL_SELECT reads the
-- budget back through RLS, so the name comes out null and
-- `toExpenseDetail` falls back to an empty string. And the id would have to be
-- guessed: they are v4 UUIDs, generated client-side in src/db/ids.ts. What is
-- left is a row that cannot be rendered honestly and an existence oracle for
-- UUIDs nobody can enumerate — small, but there is no reason to keep it.
--
-- The fix is to give the foreign key the owner to check against. A composite
-- unique key on (id, user_id) is redundant with the primary key by definition,
-- which is exactly why it is free: it adds no constraint on the data, it just
-- gives the referencing table something to point at that carries the owner
-- along with the id.
alter table public.budgets
  add constraint budgets_id_user_key unique (id, user_id);

alter table public.categories
  add constraint categories_id_user_key unique (id, user_id);

-- Dropped and added as separate statements rather than as subcommands of one
-- ALTER TABLE. Postgres does run drops in an earlier pass than adds, so the
-- combined form works — but it works for a reason a reader has to know, and the
-- name being reused is what makes it non-obvious. Six statements that each do
-- one thing cost nothing here.
--
-- MATCH SIMPLE is the default and is what is wanted: when any column of the
-- reference is null the constraint is not enforced, so a nullable
-- `category_id` still means "uncategorised" rather than failing for want of a
-- category to point at.
alter table public.expenses drop constraint if exists expenses_budget_id_fkey;
alter table public.expenses
  add constraint expenses_budget_id_fkey
    foreign key (budget_id, user_id) references public.budgets (id, user_id);

alter table public.expenses drop constraint if exists expenses_category_id_fkey;
alter table public.expenses
  add constraint expenses_category_id_fkey
    foreign key (category_id, user_id) references public.categories (id, user_id);

alter table public.incomes drop constraint if exists incomes_budget_id_fkey;
alter table public.incomes
  add constraint incomes_budget_id_fkey
    foreign key (budget_id, user_id) references public.budgets (id, user_id);

-- The constraint names are kept identical to the ones Postgres generated for
-- the single-column versions. PostgREST names relationships after the
-- constraint when it needs to disambiguate them, and the embed hints in
-- src/data/supabase-repository.ts (`budget:budgets(...)`,
-- `category:categories(...)`) rely on there being exactly one foreign key
-- between each pair of tables. Reusing the names means that if a hint is ever
-- needed, it is the one already written down.
