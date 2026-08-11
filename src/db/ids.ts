import * as Crypto from 'expo-crypto';

/**
 * Client-generated UUIDv4. Rows are created offline and will eventually be
 * pushed to Supabase, so ids have to be unique without a round trip to a server
 * — an autoincrementing integer would collide across devices on first sync.
 */
export function newId(): string {
  return Crypto.randomUUID();
}

/** UTC ISO-8601 instant, used for sync ordering (never for expense dates). */
export function nowIso(): string {
  return new Date().toISOString();
}
