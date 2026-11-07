# budgetit

An Expo app — on the web and on iOS — for logging expenses against budgets, backed by Supabase for storage and auth.

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

   If you use Resend, `scripts/configure-auth-email.sh` does all of the above against the linked project in one go — SMTP, all three code templates, the OTP length, dual-confirmation email change, signup confirmation, and the password policy — then reads back what the server actually stored, including whether each template carries `{{ .Token }}`. It needs `SUPABASE_ACCESS_TOKEN` in the environment and `RESEND_API_KEY` / `BUDGETIT_MAIL_FROM` in `.env.local`.

   > **Deliverability trap:** sending from a provider's shared sandbox address (Resend's `onboarding@resend.dev`, for example) only reaches the address the provider account was registered with. Reset emails to anyone else vanish silently. Verify a domain before letting real users near the reset flow.

5. **Run `scripts/configure-auth-email.sh`, or set the same things by hand.** Four of them are not cosmetic, and the app cannot detect that they are missing — every prompt still appears, while the server accepts requests that skip the prompts entirely:

   | Setting | Must be | Why |
   | --- | --- | --- |
   | `password_min_length` | `12` | `src/lib/password.ts` promises this. GoTrue defaults to **6**, and the app's check is skipped by anyone posting straight to `/auth/v1/signup`. |
   | Secure email change | on | Otherwise only the *new* address confirms, so an access token is enough to move an account to somebody else's inbox — and every recovery path with it. |
   | Reauthentication on password change | on | Otherwise a bare access token can set a new password. The "current password" field is enforced by the client and by nothing else. |
   | Confirm email | on | Otherwise accounts can be opened against addresses nobody proved they own. |

   The script's last block reads all four back and prints `WRONG` with the value it found. That readback is the point — these are settings that fail silently and look fine from inside the app.

5. **Start the app**

   ```bash
   pnpm start
   ```

### Running as a website

The same codebase exports to a static site, which is the way to get budgetit onto an iPhone without the App Store: open the site in Safari, **Share → Add to Home Screen**, and it launches full-screen from its own icon, with the session kept in `localStorage`.

```bash
pnpm web          # dev server in the browser
pnpm build:web    # static export into dist/
npx expo serve    # serve dist/ locally, the way a host would
pnpm deploy:web   # build on Vercel and publish to production
```

It is hosted on Vercel at **https://budgetit-six.vercel.app**. `vercel.json` holds the whole setup: Vercel installs with pnpm 12.9.1, runs the static export, and serves `dist/`. It also maps `/budget/123` and the other `[id]` routes onto their exported pages, which a static host can't work out on its own. The project is linked to the GitHub repo, so a push to `main` deploys too.

The build runs on Vercel, not your machine, so it reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Vercel project's environment variables (`vercel env ls`). `.vercelignore` keeps `.env.local` out of the upload because it holds `RESEND_API_KEY`. If the build fails with "Missing Supabase credentials", the Vercel variables are what's missing.

What is different on web:

- **No daily reminder.** Local scheduled notifications have no browser equivalent, so the setting is hidden (`SCHEDULING_SUPPORTED` in `src/lib/notifications.ts`). A web reminder would need Web Push and a server to send it.
- **Date and time fields are the browser's own** `<input type="date|time">` (`src/components/ui/date-time-picker.web.tsx`), because the community picker renders nothing on web.
- **Home-screen install** comes from `src/app/+html.tsx` and `public/manifest.json`. The icons in `public/` are generated from `assets/images/icon.png`; regenerate them if the icon changes.

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

`supabase start` runs the whole stack in Docker and applies the migrations. Point `.env.local` at the URL and publishable key it prints.

Local runs from `supabase/config.toml`, which turns email confirmation, dual-confirmation email change and password reauthentication **on** — the same as production, so a flow that works here works there. Every email those produce is caught by the local inbox at <http://127.0.0.1:54324> rather than sent, so none of it needs a real mailbox. Nothing in `config.toml` reaches the linked project; see the SCOPE note in that file, and use `scripts/configure-auth-email.sh` for anything that has to.

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
- **Dates come in two flavours.** `spentOn` / `receivedOn` / `movedOn` are local calendar days (`YYYY-MM-DD`, Postgres `date`) and must not shift across time zones. `createdAt` / `updatedAt` / `deletedAt` are UTC instants used for ordering.
- **Deletes are soft.** Every read filters `deleted_at IS NULL`; `delete*` writes a tombstone. The one exception is "reset all data", which hard-deletes — a reset means the data never happened.
- **Reads don't filter by `user_id`.** RLS already restricts every table to `auth.uid()`, and a second copy of that rule in the client would be one that can drift. Writes *do* carry the id, to satisfy the policies' `with check`.

### Database

`supabase/migrations/` holds the schema. Every table has RLS enabled with a single `for all` policy scoped to the owner. Three things run server-side rather than in the client:

- `seed_default_categories()`, called by a trigger on `auth.users`, so a new account has six categories before its first launch. Seeding on signup keeps it exactly-once; doing it client-side would let two devices race and seed twice.
- `reset_all_data()`, so the wipe and the reseed share a transaction instead of being six round trips with no way to roll back a failure halfway through.
- `month_flow()`, because the balance it carries into a month is a sum over *all* history rather than one bounded range. Every other rollup is a client-side reduce over a fetched month; this is the one big enough to meet PostgREST's row cap, where a truncated response would report a plausible wrong balance rather than failing.
- `delete_goal()`, so a goal and every contribution to it are tombstoned in one transaction. Two round trips with a failure between them would leave money set aside for a goal that no longer exists — short in the balance, with nothing on screen to attribute it to.

New tables need **explicit `grant`s** to `authenticated`. The original tables didn't, because `auto_expose_new_tables` defaulted to true when they were created; it now defaults to false, and the symptom of forgetting is a 404 from the Data API rather than anything the migration itself flags.

### Saving up for things

A **goal** is the mirror of a budget: a pot money goes *into* rather than one it comes out of. Money moved into one leaves the spendable balance without being spent, so a car fund shows up in "Left" — which means "left to spend" — but never in the donut, never against a budget's limit, and never as an expense.

The shortcut this replaces is a budget called "Savings" with expenses logged against it. It gets the balance right and everything else wrong: the money reads as gone, it competes with groceries in the category chart, and there is nowhere to record what it is *for* or how far along it is.

Two rules follow, and both are load-bearing:

- **A contribution carries an explicit `direction`, not a signed amount.** Money comes back out of goals — plans change, and the day you buy the car it has to return to the balance so the expense can be logged against it. Explicit direction keeps `amount_minor >= 0` enforceable in the database rather than as a rule only the client remembers.
- **Deleting a goal releases its money**, which is the opposite of deleting a budget. A budget's expenses are money genuinely gone and the history has to stand; a goal's contributions are an *earmark*, and withdrawing the earmark is the whole meaning of deleting one. Leaving them behind would strand the money permanently.

Contributions appear in Activity alongside expenses and income. Without a row for one, "Left" on Home drops by a few hundred with nothing anywhere to account for it — the same problem the carried-over line below exists to solve.

### Money carries over

A month's "Left" is `carried in + in − out − set aside`, not `in − out`: what was left in July is still yours in August. The carried figure is **derived on every read, never stored** — expenses can be logged into a month that has already closed, and a snapshot taken at the boundary would go stale the moment one arrived. Summing the history instead means a receipt entered late corrects every month after it. Deficits roll forward too, for the same reason surpluses do.

## Scripts

| Command | Does |
| --- | --- |
| `pnpm start` | Expo dev server |
| `pnpm ios` / `pnpm android` / `pnpm web` | Start on a specific platform |
| `pnpm build:web` | Static web export into `dist/` |
| `pnpm deploy:web` | Deploy to Vercel production |
| `pnpm lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
