# budgetit

An Expo app for logging expenses against budgets, backed by Supabase for storage and auth.

## Setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Create a Supabase project** at [supabase.com/dashboard](https://supabase.com/dashboard), then apply the schema. Either link the CLI and push:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   …or paste `supabase/migrations/20260804000000_initial_schema.sql` into the dashboard SQL editor and run it.

3. **Configure credentials**

   ```bash
   cp .env.example .env.local
   ```

   Fill in the project URL and publishable key from **Project Settings → API Keys**. Both are safe in a client bundle — the publishable key grants nothing beyond what the row level security policies allow. The *secret* key bypasses RLS entirely and must never go in this file.

   Expo inlines `EXPO_PUBLIC_*` variables at build time, so restart the dev server after editing them.

4. **Set up an email provider**, or password reset won't work. Supabase's built-in sender is capped at roughly two emails an hour and — on the free tier — will not let you edit email templates, which this app needs (see [Password reset](#password-reset) below). Add SMTP credentials under **Authentication → Emails → SMTP Settings**; Resend and Brevo both have free tiers that are plenty for this.

   Then set the recovery template to send a code rather than a link, under **Authentication → Emails → Reset Password**:

   ```html
   <h2>Reset your password</h2>
   <p>Enter this code in the budgetit app:</p>
   <p><strong>{{ .Token }}</strong></p>
   ```

   Check that **`mailer_otp_length`** (Authentication → Sign In / Providers) matches `EMAIL_CODE_LENGTH` in `src/data/auth.tsx`. Supabase currently defaults to 8; older projects are often 6. If they disagree, the input truncates a correct code and rejects it.

   If you use Resend, `scripts/configure-auth-email.sh` does all of the above against the linked project in one go — SMTP, both code templates, the OTP length, and the single-code email change — and reads back what the server actually stored, including whether each template carries `{{ .Token }}`. It needs `SUPABASE_ACCESS_TOKEN` in the environment and `RESEND_API_KEY` / `BUDGETIT_MAIL_FROM` in `.env.local`.

   > **Deliverability trap:** sending from a provider's shared sandbox address (Resend's `onboarding@resend.dev`, for example) only reaches the address the provider account was registered with. Reset emails to anyone else vanish silently. Verify a domain before letting real users near the reset flow.

5. **Start the app**

   ```bash
   pnpm start
   ```

### Building for a device

Everything the app imports is bundled in Expo Go, so `pnpm start` and a QR scan is the quickest way onto a phone. A standalone build goes through EAS:

```bash
eas login
eas init            # writes extra.eas.projectId into app.json
eas build --profile preview --platform ios
```

`.env.local` is gitignored, and **EAS Build does not upload gitignored files** — so a build that relies on it produces an app that dies on launch, because `src/lib/supabase.ts` throws at import time when the credentials are missing. Push the two public values to EAS instead, once per environment:

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://your-ref.supabase.co" --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "sb_publishable_..." --visibility plaintext
```

`eas.json` maps each build profile to the matching environment, so the values land in the bundle from there. Repeat for `production` when you get that far. `RESEND_API_KEY` is deliberately absent: nothing in the client sends email, and a Resend key in a shipped bundle is a key anyone can extract.

### Working against a local database

`supabase start` runs the whole stack in Docker and applies the migrations. Point `.env.local` at the URL and publishable key it prints, and note that its default settings skip email confirmation — handy for testing signup without a mail inbox.

## Architecture

**Every screen talks to `Repository`** (`src/data/repository.ts`) and nothing else. No screen imports the Supabase client directly. That boundary is what let the original SQLite implementation be swapped for `src/data/supabase-repository.ts` without a single screen changing, and it is what would let an offline-first implementation slot in later as a third.

**`DataProvider`** (`src/data/store.tsx`) is the reactivity layer. There are no live queries: a `revision` counter is bumped by every mutation and `useQuery` re-runs when it changes. Refetching everything on every write is knowingly brute-force, and invisible at this data size.

**Auth is a gate, not a feature.** `AuthProvider` sits above `DataProvider` because the repository cannot be built without a user id to stamp on writes. The root navigator uses `Stack.Protected`, so screens behind a false guard are never registered — a deep link while signed out lands on sign-in rather than briefly rendering a screen whose queries would be rejected.

### Password reset

**Codes, not links.** A reset *link* has to carry the user back into the app through a custom URL scheme, which fails in Expo Go (no scheme registered), fails from a desktop mail client, fails on a second device, and fails silently if the redirect isn't allowlisted — Supabase drops an unlisted `redirect_to` and falls back to the Site URL rather than erroring. An emailed code the user retypes has none of those failure modes and nothing to configure wrong. That is why `resetPasswordForEmail` is called without `redirectTo`, and why the app never registers a deep-link handler.

The whole flow is three steps on one screen (`src/app/reset-password.tsx`): request a code, verify it, choose a password. One screen rather than three routes because `verifyOtp` needs the email address again in step two, and threading it through navigation params would put it in the URL bar on web.

The subtle part: **verifying the code signs the user in for real.** Without the `passwordRecovery` flag, the root navigator would see a valid session and drop them into the app having never asked for the password they came to change. So the flag outranks `session` in the guard, it is raised *before* `verifyOtp` is awaited (or the tab bar renders for a frame), and cancelling calls `signOut` rather than merely navigating away — a verified code is full access to the account.

### Conventions worth knowing before editing

- **Ids are client-generated UUIDs.** A row can be built and inserted without a round trip to find out what it is called.
- **Money is an integer count of minor units**, never a float. A sum of 100 expenses should not land on 249.99999999997.
- **Dates come in two flavours.** `spentOn` / `receivedOn` are local calendar days (`YYYY-MM-DD`, Postgres `date`) and must not shift across time zones. `createdAt` / `updatedAt` / `deletedAt` are UTC instants used for ordering.
- **Deletes are soft.** Every read filters `deleted_at IS NULL`; `delete*` writes a tombstone. The one exception is "reset all data", which hard-deletes — a reset means the data never happened.
- **Reads don't filter by `user_id`.** RLS already restricts every table to `auth.uid()`, and a second copy of that rule in the client would be one that can drift. Writes *do* carry the id, to satisfy the policies' `with check`.

### Database

`supabase/migrations/` holds the schema. Every table has RLS enabled with a single `for all` policy scoped to the owner. Three things run server-side rather than in the client:

- `seed_default_categories()`, called by a trigger on `auth.users`, so a new account has six categories before its first launch. Seeding on signup keeps it exactly-once; doing it client-side would let two devices race and seed twice.
- `reset_all_data()`, so the wipe and the reseed share a transaction instead of being six round trips with no way to roll back a failure halfway through.
- `month_flow()`, because the balance it carries into a month is a sum over *all* history rather than one bounded range. Every other rollup is a client-side reduce over a fetched month; this is the one big enough to meet PostgREST's row cap, where a truncated response would report a plausible wrong balance rather than failing.

### Money carries over

A month's "Left" is `carried in + in − out`, not `in − out`: what was left in July is still yours in August. The carried figure is **derived on every read, never stored** — expenses can be logged into a month that has already closed, and a snapshot taken at the boundary would go stale the moment one arrived. Summing the history instead means a receipt entered late corrects every month after it. Deficits roll forward too, for the same reason surpluses do.

## Scripts

| Command | Does |
| --- | --- |
| `pnpm start` | Expo dev server |
| `pnpm ios` / `pnpm android` / `pnpm web` | Start on a specific platform |
| `pnpm lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
