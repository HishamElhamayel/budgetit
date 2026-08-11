-- budgetit — carry the balance forward across months.
--
-- Money left at the end of a month is still the user's money in the next one, so
-- a month's figures need an *opening balance*: everything earned before the
-- period, less everything spent before it.
--
-- Two properties this has to have, and they are what decides the shape below.
--
-- **It is derived, never stored.** Expenses can be logged into a month that has
-- already closed — that is the whole point of the date picker on the expense
-- form — and a snapshot taken at the month boundary would go stale the moment
-- one arrived. Summing the history on every read means a receipt entered late
-- corrects every month after it, for free.
--
-- **It is summed in Postgres, not in the client.** Every other rollup in this
-- app is a client-side reduce over a fetched month (see the header of
-- `src/data/supabase-repository.ts`), which is fine when the range is bounded.
-- This one is unbounded — it spans all history — so it is exactly the query that
-- eventually meets PostgREST's row cap, and a truncated response would not fail
-- loudly, it would quietly report the wrong balance. A scalar sum has no cap.

-- `security invoker` (stated explicitly, since plpgsql-style definer defaults
-- catch people out) so the RLS policies on both tables apply to the caller and
-- the sums cover their rows only. `stable` because it reads and writes nothing.
create function public.month_flow(from_day date, to_day date)
returns table (opening_minor bigint, in_minor bigint, out_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    -- Income and expense unioned into one signed ledger, so the opening balance
    -- is a single sum rather than two that have to be subtracted in the right
    -- order. `direction` is carried explicitly rather than inferred from the
    -- sign of the amount, so a zero-amount row still lands in the right bucket.
    select received_on as day, amount_minor as amount, 1 as direction
    from public.incomes
    where deleted_at is null and received_on <= to_day
    union all
    select spent_on, amount_minor, -1
    from public.expenses
    where deleted_at is null and spent_on <= to_day
  )
  select
    coalesce(sum(amount * direction) filter (where day < from_day), 0)::bigint,
    coalesce(sum(amount) filter (where day >= from_day and direction = 1), 0)::bigint,
    coalesce(sum(amount) filter (where day >= from_day and direction = -1), 0)::bigint
  from entries;
$$;
