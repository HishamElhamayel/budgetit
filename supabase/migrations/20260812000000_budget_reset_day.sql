-- budgetit — let a monthly budget restart on a day other than the 1st.
--
-- A calendar month is an accounting convention, not a pay cycle. Salaries land
-- on the 25th, or on the last working day, and a budget that resets on the 1st
-- spends the last week of every month reporting a limit the user already spent
-- against the money that arrived for the *next* one.
--
-- Nullable on purpose, and null does not mean "the 1st". It means "follow the
-- account's `periodStartDay` preference", so moving payday is one edit in
-- settings rather than one per budget. A budget that genuinely differs from the
-- salary — rent, due on the 1st regardless — pins its own day here and stops
-- tracking the app-wide one.
--
-- No default and no backfill: every existing budget stays null, which resolves
-- to the preference, which itself defaults to 1. Nothing moves until the user
-- says so.
--
-- The check is `between 1 and 31` rather than a per-month bound, because the
-- column has no month to be validated against. Day 31 in February is resolved
-- by clamping at read time (see `periodRange` in src/lib/date.ts) — clamping
-- rather than spilling forward, so periods keep tiling the calendar with no
-- gaps and no overlaps.
alter table public.budgets
  add column reset_day integer check (reset_day between 1 and 31);

comment on column public.budgets.reset_day is
  'Day of month a monthly cycle restarts, 1-31. Null follows the periodStartDay preference. Ignored when cycle = ''weekly''.';
