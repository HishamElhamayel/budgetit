-- budgetit — user profiles.
--
-- Everything the app knows about a person that isn't a credential: their name,
-- and the country they're in. Both are optional at the database level even
-- though the sign-up form asks for the name, because the form is not the only
-- way a row gets here — the backfill at the bottom of this file creates one for
-- every account that existed before this migration, and those have no name to
-- give it.
--
-- Why a table rather than `auth.users.raw_user_meta_data`, which `signUp` can
-- populate for free: user metadata is writable by the user's own access token,
-- so anything read back from it is a value the client last wrote to itself. A
-- profile row with its own policies is somewhere the rules can actually live —
-- today that means "you may not change your own user_id", and it is the seam
-- any later rule (verified flags, plan tier, referral source) fits into without
-- another migration to move the data. Metadata is still used, but only as the
-- one-way channel that carries the sign-up form's answers into the trigger
-- below, which is the only moment the two are allowed to touch.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.profiles (
  -- The primary key *is* the user id. One profile per account, enforced by the
  -- shape rather than by a unique index someone has to remember to add.
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Null means never given, which is different from given-and-then-cleared —
  -- the form writes null for both, but the distinction costs nothing to keep.
  -- The cap is generous rather than principled; it exists so a runaway paste
  -- can't put a megabyte of text behind a greeting.
  full_name text check (char_length(full_name) <= 80),
  -- ISO 3166-1 alpha-2, matching src/constants/countries.ts. Checked as a
  -- shape, not against a list: country codes change (and are added) on the
  -- world's schedule, not on this schema's, and a `check ... in (...)` here
  -- would turn a new territory into a migration.
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Deliberately *not* the `for all` policy the other tables use. Two of the four
-- verbs need to behave differently here:
--
--   * insert is the trigger's job, not the client's, and the trigger runs as
--     definer so it bypasses these policies entirely. A client-facing insert
--     policy is kept anyway as a repair path — a row lost to a trigger that
--     failed mid-signup is otherwise unrecoverable from the app — but it can
--     only ever create the caller's own row.
--   * delete has no policy at all, so it is denied. A profile with no row is a
--     state nothing in the app expects, and "delete my profile" is not a thing
--     anyone means: they mean delete the account, which cascades from
--     auth.users and takes this with it.

alter table public.profiles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Signup
-- ---------------------------------------------------------------------------

-- Replaces the version in the initial migration, which only seeded categories.
-- The profile insert goes in the same trigger rather than a second one so the
-- two stay in one transaction: an account that ends up with categories but no
-- profile row is a half-created account, and there is no reason to allow it.
--
-- The values come out of the sign-up form via `options.data`, which Supabase
-- lands in `raw_user_meta_data`. `nullif(..., '')` because a form that submits
-- an empty field sends `""`, and an empty name stored as a real value would
-- read as "this person is called nothing" rather than "we never asked".
--
-- Both values are forced into range rather than trusted, and that is the part
-- worth not simplifying. This runs inside the signup transaction, so anything
-- that raises here fails the account creation itself — and `raw_user_meta_data`
-- is whatever the caller put in the request body, not whatever the sign-up
-- screen collected. A three-letter country code or an 81st character would
-- otherwise turn a check constraint into "sign-up is broken", for the one
-- person who sent it and for nobody else, which is a bug report nobody can
-- reproduce. Out-of-range values are dropped, not rejected: this is a greeting
-- and a currency hint, and neither is worth failing an account over.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, country_code)
  values (
    new.id,
    nullif(left(trim(new.raw_user_meta_data ->> 'full_name'), 80), ''),
    -- Anything that isn't already a two-letter code is discarded rather than
    -- guessed at: 'USA' is unambiguous to a human, and 'US' would be a guess
    -- the database has no business making. A CASE with no ELSE yields null,
    -- which is exactly "they didn't tell us".
    case
      when upper(trim(new.raw_user_meta_data ->> 'country_code')) ~ '^[A-Z]{2}$'
        then upper(trim(new.raw_user_meta_data ->> 'country_code'))
    end
  )
  -- The trigger is the only writer at this point, but an account created twice
  -- by a retried signup should not fail the second attempt on a key collision.
  on conflict (user_id) do nothing;

  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Accounts that predate this table. Their metadata has no name in it — nothing
-- ever asked — so these rows are created empty and filled in the first time the
-- user opens the profile screen. Creating them now rather than lazily means the
-- client only ever has to handle "profile with null fields", not "no profile",
-- which is one less shape for every read to branch on.
-- Same clamping as the trigger, and for a sharper version of the same reason:
-- one bad value in one old account would abort this statement, and with it the
-- migration and every account's profile.
insert into public.profiles (user_id, full_name, country_code)
select
  users.id,
  nullif(left(trim(users.raw_user_meta_data ->> 'full_name'), 80), ''),
  case
    when upper(trim(users.raw_user_meta_data ->> 'country_code')) ~ '^[A-Z]{2}$'
      then upper(trim(users.raw_user_meta_data ->> 'country_code'))
  end
from auth.users as users
on conflict (user_id) do nothing;

-- Note what `reset_all_data` does *not* do: it leaves this table alone. "Reset
-- all data" means the budgets, expenses and incomes — the things the user
-- entered about their money. Forgetting their name as a side effect of clearing
-- their spending history would be a surprise, and they would have no way to
-- tell it apart from a bug.
