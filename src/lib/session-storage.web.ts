/**
 * Web has a real `localStorage`, which is what supabase-js reaches for when no
 * adapter is supplied. Returning undefined rather than wiring one up keeps the
 * wasm SQLite build out of the web bundle entirely — see `session-storage.ts`.
 */

import type { SupportedStorage } from '@supabase/supabase-js';

export const sessionStorage: SupportedStorage | undefined = undefined;
