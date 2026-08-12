/**
 * The ledger's reads, one window at a time — with the neighbouring windows
 * already in hand.
 *
 * Activity is the one screen people *traverse*: they step back a month, then
 * another, then forward again. Under a plain `useQuery` every one of those taps
 * is a round trip to Supabase, and because a query keeps its previous result on
 * screen while the next is in flight, the header flips to the new month while
 * the rows underneath still show the old one. Nothing is wrong for longer than
 * a few hundred milliseconds, but the screen spends those milliseconds lying.
 *
 * So this hook keeps windows in a cache and warms the two the user is one tap
 * away from. Stepping then swaps rows that are already in memory — no request,
 * no interim frame showing the wrong month. The cache is what makes the
 * loading state honest, too: a miss is now rare enough that it can say
 * "loading" outright instead of holding stale rows to cover for itself.
 *
 * Entries are kept across mutations rather than dropped, and refetched in the
 * background instead. Dropping them would mean a swipe-delete emptied the list
 * it was deleting from — the same "your data is gone" frame the store's
 * stale-while-revalidate is written to avoid.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Repository } from '@/data/repository';
import { readWithRetries, useData } from '@/data/store';
import type { ExpenseDetail, IncomeDetail } from '@/db/types';
import { addDays, addPeriods, periodRange, today } from '@/lib/date';

export type ActivityPeriod = 'day' | 'period';

export interface DayRange {
  /** Inclusive `YYYY-MM-DD` bounds. */
  from: string;
  to: string;
}

export interface ActivityWindow {
  expenses: ExpenseDetail[];
  incomes: IncomeDetail[];
}

/**
 * How many windows to hold. Enough for a long traversal in one direction plus
 * the prefetched edges, small enough that the memory is a rounding error at
 * this data size.
 */
const MaxCachedWindows = 16;

interface CacheEntry {
  window: ActivityWindow;
  /** The store revision this was read at; anything older is refetched. */
  revision: number;
}

export interface ActivityWindowResult {
  /** The range the current anchor and period resolve to. */
  range: DayRange;
  /**
   * The best rows available for this range: the window itself, or the same
   * range under a previous search term while a narrowed read is in flight.
   * Undefined only when the range has never been read — which is the screen's
   * cue to draw a skeleton, and the only state in which it should.
   */
  window: ActivityWindow | undefined;
}

export function useActivityWindow({
  anchor,
  period,
  startDay,
  search,
}: {
  anchor: string;
  period: ActivityPeriod;
  /** The day of the month a budget period begins on. */
  startDay: number;
  search: string;
}): ActivityWindowResult {
  const { repo, revision } = useData();

  const range = useMemo(
    () => rangeFor(anchor, period, startDay),
    [anchor, period, startDay]
  );

  // Every window a single tap can reach: the two either side, and the present —
  // which is where the jump-back control goes, however far from it the user has
  // wandered. The neighbours are warmed even at the present edge, where "next"
  // is a window the arrow won't currently open, because the user can step back
  // and forward again and a range that holds nothing costs one empty read to
  // learn. Anything already cached and current is skipped, so this settles to no
  // requests at all once a traversal has been over the same ground.
  //
  // Not while a search is active, though. Search re-queries on every keystroke,
  // and prefetching there would multiply the traffic of typing to warm windows
  // the user is unlikely to step into before changing the term again.
  const prefetch = useMemo(
    () =>
      search
        ? []
        : [
            rangeFor(stepAnchor(anchor, period, startDay, -1), period, startDay),
            rangeFor(stepAnchor(anchor, period, startDay, 1), period, startDay),
            rangeFor(today(), period, startDay),
          ],
    [anchor, period, startDay, search]
  );

  // The cache is written from effects and read from render, so it lives in both
  // places: the ref is the copy the effect reasons about (always current, even
  // between renders), and the state is the copy the screen draws from. Keeping
  // one ref and reading it during render would be the smaller version of this,
  // and also the one the React compiler is entitled to break.
  const cache = useRef(new Map<string, CacheEntry>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const [snapshot, setSnapshot] = useState<Map<string, CacheEntry>>(() => new Map());

  const key = windowKey(range, search);
  const prefetchKeys = prefetch.map((entry) => windowKey(entry, search)).join('|');

  useEffect(() => {
    let cancelled = false;

    async function fill(target: DayRange, visible: boolean) {
      const targetKey = windowKey(target, search);
      const cached = cache.current.get(targetKey);
      if (cached && cached.revision === revision) return;

      // Deduped rather than merely guarded: the visible window and a neighbour
      // can be the same range across a period toggle, and two reads of it would
      // race to fill the same slot.
      let pending = inflight.current.get(targetKey);
      if (!pending) {
        // Deliberately not cancellable. A read in flight is worth finishing
        // whoever asked for it — it lands in the cache and spares whoever
        // arrives next — and a shared promise that aborted because *one*
        // consumer walked away would reject the consumer still waiting.
        pending = (async () => {
          try {
            const window = await readWithRetries(() => read(repo, target, search));
            cache.current.set(targetKey, { window, revision });
            evict(cache.current);
          } finally {
            inflight.current.delete(targetKey);
          }
        })();
        inflight.current.set(targetKey, pending);
      }

      try {
        await pending;
      } catch (error) {
        // A prefetch that fails is not worth reporting: nothing is waiting on
        // it, and the window will be read again the moment it's navigated to.
        if (visible && !cancelled) console.error('[budgetit] activity read failed', error);
        return;
      }

      if (!cancelled) setSnapshot(new Map(cache.current));
    }

    void (async () => {
      // Awaited before the prefetches so the window being *looked at* isn't
      // queued behind ones the user hasn't asked for.
      await fill(range, true);
      for (const target of prefetch) {
        if (cancelled) return;
        await fill(target, false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `prefetchKeys` stands in for `prefetch`, which is a fresh array whenever
    // the anchor moves but holds the same ranges far more often than that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision, key, prefetchKeys, search]);

  const entry = snapshot.get(key);
  // A miss on the exact key still has something to show if the same *range* was
  // read under a different search term — which is precisely what every keystroke
  // in the search box produces. Holding those rows steady while the narrowed
  // read is in flight is the difference between a list that filters and one that
  // blinks out six times as a word is typed. A miss on the range itself has no
  // such stand-in, and gets the skeleton.
  //
  // A stale entry — the right window, read before the last mutation — is shown
  // for the same reason: it is about to be replaced by its own refetch, and
  // announcing that would blank a list the user is looking at.
  const best = entry ?? mostRecentForRange(snapshot, range);

  return { range, window: best?.window };
}

function mostRecentForRange(
  cache: Map<string, CacheEntry>,
  range: DayRange
): CacheEntry | undefined {
  const prefix = `${range.from}:${range.to}:`;
  let latest: CacheEntry | undefined;

  // Insertion order, so the last match is the one read most recently.
  for (const [candidate, entry] of cache) {
    if (candidate.startsWith(prefix)) latest = entry;
  }

  return latest;
}

function rangeFor(anchor: string, period: ActivityPeriod, startDay: number): DayRange {
  if (period === 'day') return { from: anchor, to: anchor };
  const { start, end } = periodRange(anchor, startDay);
  return { from: start, to: end };
}

function stepAnchor(
  anchor: string,
  period: ActivityPeriod,
  startDay: number,
  direction: -1 | 1
): string {
  return period === 'day' ? addDays(anchor, direction) : addPeriods(anchor, startDay, direction);
}

function windowKey(range: DayRange, search: string): string {
  return `${range.from}:${range.to}:${search}`;
}

async function read(repo: Repository, range: DayRange, search: string): Promise<ActivityWindow> {
  const query = { from: range.from, to: range.to, search: search || undefined };

  // Two reads rather than one `listActivity` on the repository: expenses and
  // income are separate tables with separate date columns, so a combined read
  // would be these same two queries with the merge moved behind the interface.
  const [expenses, incomes] = await Promise.all([
    repo.listExpenses(query),
    repo.listIncomes(query),
  ]);

  return { expenses, incomes };
}

/** Oldest insertion first, which is also least-recently-fetched. */
function evict(cache: Map<string, CacheEntry>) {
  while (cache.size > MaxCachedWindows) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}
