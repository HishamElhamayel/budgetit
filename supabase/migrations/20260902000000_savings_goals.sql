-- budgetit — things you are saving up for.
--
-- A goal is a pot you put money *into* rather than spend *from*: a car, a
-- laptop, three months of rent in reserve. Money moved into one leaves the
-- spendable pool without being spent, which is the whole point — "Left" on Home
-- should mean "left to spend", and money earmarked for a car is not that.
--
-- Two modelling decisions carry the feature, and both are deliberate departures
-- from the obvious shortcut.
--
-- **A contribution is not an expense.** The shortcut is a budget called
-- "Savings" and an expense logged against it, which is what this app's
-- onboarding has been quietly suggesting. It gets the balance right and
-- everything else wrong: the money reads as gone, it lands in the category
-- donut competing with groceries, it counts against a limit, and there is
-- nowhere to say what it is *for* or how far along it is. A separate table
-- keeps "spent" and "set aside" as the different facts they are.
--
-- **A contribution carries an explicit direction rather than a signed amount.**
-- Same reason `month_flow` already carries one: a zero-amount row still has to
-- land in the right bucket, and `amount_minor >= 0` stays enforceable as a
-- check constraint rather than becoming a rule only the client remembers.
-- Money comes back out of goals — plans change, and the day you actually buy
-- the car the money has to return to the pool so the expense can be logged
-- against it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- Null means "save towards this, but there is no finish line" — the reserve
  -- pot that has no natural number attached. The mirror of a budget with no
  -- limit, and offered for the same reason: a target invented to satisfy a
  -- required field is a target the progress bar then lies about.
  target_minor bigint,
  -- Null means "no date in mind". A local calendar day, not an instant, for the
  -- reason spelled out on `expenses.spent_on`.
  target_day date,
  -- Goals get an icon where budgets don't. A budget is an abstraction the user
  -- invented ("Personal"); a goal is a *thing* — and a thing has a picture.
  icon text not null default 'star',
  color_slot integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint goals_name_length check (char_length(name) <= 80),
  -- Same ceiling as every other money column, and nullable-aware: null is "no
  -- target", which the range must not reject.
  constraint goals_target_range check (
    target_minor is null or (target_minor >= 0 and target_minor <= 1000000000000000)
  ),
  -- Redundant with the primary key by definition, which is exactly why it is
  -- free: it gives `goal_contributions` something to point at that carries the
  -- owner along with the id. See the same pair on `budgets` in the input_bounds
  -- migration for why a plain single-column reference is not enough.
  constraint goals_id_user_key unique (id, user_id)
);

create table public.goal_contributions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- NOT NULL, unlike `incomes.budget_id`: a movement with no goal is not an
  -- unfiled movement, it is nothing at all.
  goal_id uuid not null,
  amount_minor bigint not null,
  -- 'in' takes money out of the spendable pool and puts it in the goal; 'out'
  -- gives it back. Named from the goal's point of view rather than the pool's,
  -- because that is the direction the user is thinking in when they tap.
  direction text not null check (direction in ('in', 'out')),
  -- "Bonus", "changed my mind", "deposit". The free-text field this table's
  -- rows are searched on in Activity, the counterpart of an expense's
  -- description and an income's source.
  note text,
  moved_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint goal_contributions_amount_range check (
    amount_minor >= 0 and amount_minor <= 1000000000000000
  ),
  constraint goal_contributions_note_length check (char_length(note) <= 500),
  constraint goal_contributions_goal_id_fkey
    foreign key (goal_id, user_id) references public.goals (id, user_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
--
-- user_id leads, as everywhere: every query is scoped to one account. The
-- trailing columns cover the two real reads — the ledger window (by day,
-- newest first) and one goal's running total.
create index idx_goals_user on public.goals (user_id, sort_order, created_at);
create index idx_goal_contributions_user_moved_on
  on public.goal_contributions (user_id, moved_on desc, created_at desc);
create index idx_goal_contributions_user_goal
  on public.goal_contributions (user_id, goal_id, moved_on);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- One `for all` policy per table, matching every other table here: the rule
-- genuinely is the same for every verb, and splitting it four ways would be
-- four places to forget to change.

alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;

create policy "Users read and write their own goals"
  on public.goals for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read and write their own goal contributions"
  on public.goal_contributions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Explicit grants, which the older tables in this schema did not need.
-- `auto_expose_new_tables` defaulted to true when they were created; it now
-- defaults to false, so a new table is invisible to PostgREST until its
-- privileges are granted — and the failure is a 404 from the Data API rather
-- than anything the SQL above would flag.
--
-- `anon` is deliberately absent. Every policy above is `to authenticated`, so a
-- grant to the signed-out role would hand out a key to a door with no room
-- behind it.
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.goal_contributions to authenticated;

-- ---------------------------------------------------------------------------
-- Money in, money out, money set aside
-- ---------------------------------------------------------------------------
--
-- `month_flow` grows a fourth figure. Dropped and recreated rather than
-- replaced: `create or replace` cannot change a function's return type, and
-- this one gains a column.
--
-- Adding a column rather than folding contributions into `out_minor` is the
-- point of the whole feature. They are not spending. A month where £500 went
-- into the car fund and £500 went on rent has one figure the user wants to feel
-- bad about, and summing them would produce one that is simply wrong.
--
-- The opening balance *does* net them, because it answers "how much do I have",
-- and money in a goal is money you have decided you do not have.
drop function if exists public.month_flow(date, date);

create function public.month_flow(from_day date, to_day date)
returns table (
  opening_minor bigint,
  in_minor bigint,
  out_minor bigint,
  saved_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    -- Three sources unioned into one signed ledger, so the opening balance
    -- stays a single sum. `direction` is the effect on the *spendable pool*:
    -- income adds, an expense subtracts, and money moved into a goal subtracts
    -- exactly as an expense does — it has left the pool, it just hasn't been
    -- spent. `saved` is what keeps the two apart in the per-period figures
    -- below, where that distinction is the whole story.
    select received_on as day, amount_minor as amount, 1 as direction, false as saved
    from public.incomes
    where deleted_at is null and received_on <= to_day
    union all
    select spent_on, amount_minor, -1, false
    from public.expenses
    where deleted_at is null and spent_on <= to_day
    union all
    select
      contribution.moved_on,
      contribution.amount_minor,
      case when contribution.direction = 'in' then -1 else 1 end,
      true
    from public.goal_contributions as contribution
    where contribution.deleted_at is null and contribution.moved_on <= to_day
  )
  select
    coalesce(sum(amount * direction) filter (where day < from_day), 0)::bigint,
    coalesce(sum(amount) filter (where day >= from_day and direction = 1 and not saved), 0)::bigint,
    coalesce(sum(amount) filter (where day >= from_day and direction = -1 and not saved), 0)::bigint,
    -- Net *into* goals, so the sign is the ledger's inverted: a contribution
    -- reads -1 against the pool and +1 against the goal. Negative when the
    -- period took more back out than it put in, which is what buying the thing
    -- you were saving for looks like.
    coalesce(sum(amount * -direction) filter (where day >= from_day and saved), 0)::bigint
  from entries;
$$;

grant execute on function public.month_flow(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Deleting a goal releases its money
-- ---------------------------------------------------------------------------
--
-- The opposite of `deleteBudget`, on purpose. Deleting a budget keeps its
-- expenses, because that money is genuinely gone and the history has to stand.
-- Deleting a goal is not a claim about history — it is the user withdrawing an
-- *earmark*, and money that is no longer set aside is money they can spend. So
-- the contributions go with it and every balance recomputes as though the goal
-- had never existed.
--
-- The alternative is leaving them behind, which strands the money: the pool
-- stays short by whatever was in the goal, permanently, with nothing left on
-- any screen to explain where it went. Making the user empty the goal first
-- would reach the same end state through more taps.
--
-- One statement pair in one transaction, so a dropped connection cannot leave a
-- tombstoned goal whose contributions are still counted against the pool.
-- `security invoker` (stated, since plpgsql defaults the other way) so RLS
-- confines both updates to the caller's own rows.
create function public.delete_goal(goal uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stamp timestamptz := now();
begin
  -- Contributions first. Either order works inside a transaction, but this one
  -- reads as the money being released before the thing it was held for goes.
  update public.goal_contributions
     set deleted_at = stamp, updated_at = stamp
   where goal_id = goal and deleted_at is null;

  update public.goals
     set deleted_at = stamp, updated_at = stamp
   where id = goal and deleted_at is null;
end;
$$;

grant execute on function public.delete_goal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reset
-- ---------------------------------------------------------------------------
--
-- Replaced rather than left alone: "reset all data" that quietly kept every
-- goal would be a wipe the user cannot see the edge of. Same body as the
-- initial migration otherwise — child tables first, hard deletes, reseed.
create or replace function public.reset_all_data()
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

  -- Child tables first: expenses and incomes reference budgets, contributions
  -- reference goals.
  delete from public.expenses where user_id = caller;
  delete from public.incomes where user_id = caller;
  delete from public.goal_contributions where user_id = caller;
  delete from public.budgets where user_id = caller;
  delete from public.goals where user_id = caller;
  delete from public.categories where user_id = caller;
  delete from public.preferences where user_id = caller;

  perform public.seed_default_categories(caller);
end;
$$;

-- Redundant on any database where this function already exists — `create or
-- replace` preserves the privileges of the function it replaces — and stated
-- anyway, so that a database built from these migrations in one pass does not
-- depend on which side of the `auto_expose_new_tables` default it was created
-- on.
grant execute on function public.reset_all_data() to authenticated;
