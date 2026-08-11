-- budgetit — initial schema.
--
-- A port of the local SQLite schema (src/db/migrations.ts) to Postgres, with
-- the two conventions that were there from the start carried over intact:
--
--   * ids are client-generated UUIDs, so a row can be built and inserted
--     without a round trip to find out what it is called;
--   * money is an integer count of minor units, never a float.
--
-- The one genuinely new thing is `user_id`. It was nullable in SQLite because
-- there was no account to point at; here it is NOT NULL and every table is
-- fenced off with row level security keyed on it. `auth.uid()` is wrapped in a
-- scalar subquery in every policy — that lets Postgres evaluate it once per
-- statement instead of once per row, which is the difference between an index
-- scan and a sequential one on the expenses table.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Null means "track spending here, but don't cap it".
  limit_minor bigint,
  cycle text not null default 'monthly' check (cycle in ('weekly', 'monthly')),
  color_slot integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft-delete tombstone. Non-null rows are filtered out of every read.
  deleted_at timestamptz
);

create table public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text not null default 'tag',
  color_slot integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  budget_id uuid not null references public.budgets (id),
  -- Nullable: an expense can be logged before the user decides on a category.
  category_id uuid references public.categories (id),
  amount_minor bigint not null,
  description text,
  -- A local calendar day, not an instant. `date` rather than `timestamptz` so
  -- that a expense logged on the 3rd stays on the 3rd after a flight to Tokyo.
  spent_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.incomes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Optional — income doesn't have to belong to any single pot.
  budget_id uuid references public.budgets (id),
  amount_minor bigint not null,
  source text,
  received_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Key/value app settings, one row per key per user. Deliberately not a JSON
-- blob on a profile row: `setPreferences` writes one key at a time, and
-- concurrent writes from two devices should not clobber each other's unrelated
-- keys the way a whole-document overwrite would.
create table public.preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Every query is scoped to one user, so user_id leads each index. The trailing
-- columns then cover the three real access patterns: the expenses list (by day,
-- newest first), the charts (by budget within a cycle), and the category donut.
create index idx_expenses_user_spent_on on public.expenses (user_id, spent_on desc, created_at desc);
create index idx_expenses_user_budget on public.expenses (user_id, budget_id, spent_on);
create index idx_expenses_user_category on public.expenses (user_id, category_id, spent_on);
create index idx_incomes_user_received_on on public.incomes (user_id, received_on desc, created_at desc);
create index idx_incomes_user_budget on public.incomes (user_id, budget_id, received_on);
create index idx_budgets_user on public.budgets (user_id, sort_order, created_at);
create index idx_categories_user on public.categories (user_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- One `for all` policy per table rather than four narrow ones. The rule really
-- is the same for every verb here — you touch your rows and nobody else's — and
-- splitting it four ways would mean four places to forget to change.
--
-- `using` governs which rows are visible to read/update/delete; `with check`
-- governs what insert/update may write. Both are needed: without `with check` a
-- client could insert a row stamped with somebody else's user_id.

alter table public.budgets enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.incomes enable row level security;
alter table public.preferences enable row level security;

create policy "Users read and write their own budgets"
  on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read and write their own categories"
  on public.categories for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read and write their own expenses"
  on public.expenses for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read and write their own incomes"
  on public.incomes for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read and write their own preferences"
  on public.preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Seeding
-- ---------------------------------------------------------------------------

-- Seeded so the very first expense can be categorised without a detour into a
-- setup screen. Deliberately short — a long list of mostly-unused categories is
-- the thing that makes people pick "Other" forever.
--
-- `security definer` because the trigger below runs as the signup transaction's
-- role rather than as the new user, so `auth.uid()` is not yet the row owner and
-- the RLS policy above would reject the insert. The search_path is pinned for
-- the usual reason: a definer function that resolves `categories` through a
-- caller-controlled search_path is a privilege escalation waiting to happen.
create function public.seed_default_categories(owner uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (id, user_id, name, icon, color_slot, sort_order)
  select
    gen_random_uuid(),
    owner,
    seed.name,
    seed.icon,
    -- Colour slot and sort order both follow the listed order, which is what
    -- gives a fresh account six distinctly-coloured categories rather than six
    -- of whatever slot 0 happens to be.
    seed.position,
    seed.position
  from (
    values
      ('Groceries', 'cart', 0),
      ('Eating out', 'fork.knife', 1),
      ('Transport', 'car', 2),
      ('Bills', 'bolt', 3),
      ('Shopping', 'bag', 4),
      ('Fun', 'sparkles', 5)
  ) as seed (name, icon, position);
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

-- Seeding on signup rather than on first launch keeps it exactly-once. Doing it
-- client-side would mean two devices racing to seed the same account and
-- winning twice — there is no natural unique key to make that idempotent.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Reset
-- ---------------------------------------------------------------------------

-- "Reset all data" as a single statement, so the wipe and the reseed either
-- both happen or neither does. The client alternative is five deletes and a
-- seed over six round trips, where a dropped connection halfway leaves the
-- account with expenses pointing at deleted budgets.
--
-- Rows are hard-deleted rather than tombstoned: a reset means "this data never
-- happened", and soft-deleting would leave a pile of tombstones behind that
-- resurrect nothing useful.
--
-- `security invoker` (the default for plpgsql is definer, so it is stated
-- explicitly) — this must run as the caller so RLS confines the deletes to
-- their own rows. A definer function here would happily wipe the whole table.
create function public.reset_all_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'reset_all_data requires an authenticated user';
  end if;

  -- Child tables first: expenses and incomes both reference budgets.
  delete from public.expenses where user_id = caller;
  delete from public.incomes where user_id = caller;
  delete from public.budgets where user_id = caller;
  delete from public.categories where user_id = caller;
  delete from public.preferences where user_id = caller;

  perform public.seed_default_categories(caller);
end;
$$;
