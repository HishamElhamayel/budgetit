/**
 * The Supabase client.
 *
 * Session storage is the only part of this that needs thought. On native there
 * is no `localStorage`, so the session has to be handed somewhere durable or
 * the user is signed out every cold start; on web the browser's own one is
 * fine. `session-storage.ts` resolves that per platform.
 *
 * Note that this stores the refresh token in plain SQLite rather than the
 * device keychain, and in `localStorage` on web. That matches what the rest of
 * the app assumes (an unlocked device is a trusted device) and what Supabase's
 * own Expo guide does; moving to expo-secure-store means chunking around its
 * 2048-byte value limit, which is worth doing only if the threat model changes.
 *
 * What that argument depends on, and did not always get: a token lifted from
 * either place has to be worth less than the account. For a while it was worth
 * exactly the account — GoTrue was configured to accept a bare access token as
 * sufficient to change the email address and then the password, so anyone who
 * read this file's storage owned the account permanently. The prompts in
 * data/auth.tsx did not prevent that; they run in the app, and the attack does
 * not. Both settings are now on (see scripts/configure-auth-email.sh), so a
 * stolen token reads data and cannot keep itself.
 *
 * `[auth.sessions] inactivity_timeout` in supabase/config.toml is the other
 * half: it puts a ceiling on how long a lifted token stays valid, which
 * refresh-token rotation otherwise extends indefinitely.
 *
 * If either of those is ever turned off, this comment stops being true and
 * expo-secure-store stops being optional.
 */

import 'react-native-url-polyfill/auto';

import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { sessionStorage } from '@/lib/session-storage';

// Referenced as complete `process.env.EXPO_PUBLIC_*` expressions because Expo's
// babel transform does a literal find-and-replace at build time — destructuring
// `process.env` or building the key name dynamically yields undefined in a
// production bundle even when the variable is set.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  // Thrown at import time on purpose. The alternative is a client that builds
  // fine and then fails on every query with an opaque network error, which is a
  // far worse first five minutes for anyone cloning this repo.
  throw new Error(
    'Missing Supabase credentials. Copy .env.example to .env.local and set ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the dev server.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Undefined on web, where supabase-js falls back to `window.localStorage`.
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no OAuth callback to parse out of a URL — email and password
    // only. Leaving this on would make the client inspect deep links it has no
    // business touching.
    detectSessionInUrl: false,
    // Serialises token refreshes across concurrent callers, so two screens
    // querying at once on a stale token don't both try to spend the refresh
    // token and race one of the two into a spurious sign-out.
    lock: processLock,
  },
});

// Refresh tokens only while the app is actually in front of the user. Left
// running in the background the timer fires against a suspended JS thread on
// iOS, which produces exactly the "signed out overnight" bug this avoids.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
