/**
 * Where the auth session is persisted on native.
 *
 * `expo-sqlite/kv-store` exposes exactly the `getItem`/`setItem`/`removeItem`
 * shape supabase-js wants, and expo-sqlite is already a dependency, so this
 * costs nothing over adding AsyncStorage alongside it.
 *
 * Split into a platform file rather than a `Platform.OS` branch because Metro
 * resolves imports before any of that runs: a single import would bundle the
 * wasm SQLite build into the web output, where it goes unused but still drags
 * in the `SharedArrayBuffer` requirement (and with it the COOP/COEP headers
 * documented in metro.config.js). See `session-storage.web.ts`.
 */

import type { SupportedStorage } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

export const sessionStorage: SupportedStorage | undefined = Storage;
