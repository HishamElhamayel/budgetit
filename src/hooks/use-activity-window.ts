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
import type { ContributionDetail, ExpenseDetail, IncomeDetail } from '@/db/types';
import { addDays, addPeriods, periodRange, today } from '@/lib/date';

export type ActivityPeriod = 'day' | 'period';

/**
 * The one dimension the ledger is narrowed on, beyond its window.
 *
 * Budget, category *or* goal, never two at once. They are not orthogonal in the
 * way a multi-axis filter would imply — a category filter already excludes
 * income outright (see `read`), so combining it with a budget would produce a
 * view whose "in" total is structurally zero and whose budget chip did nothing
 * to earn its place in the state. A goal is more extreme still: nothing but
 * contributions can match one, so intersecting it with either of the others is
 * guaranteed empty. One active filter also means one chip row and one thing to
 * clear.
 */
export interface ActivityFilter {
  kind: 'budget' | 'category' | 'goal';
  id: string;
}

export interface DayRange {
  /** Inclusive `YYYY-MM-DD` bounds. */
  from: string;
  to: string;
}

export interface ActivityWindow {
  expenses: ExpenseDetail[];
  incomes: IncomeDetail[];
  contributions: ContributionDetail[];
}

/**
 * How many windows to hold. Enough for a long traversal in one direction plus
 * the prefetched edges, small enough that the memory is a rounding error at
 * this data size.
 *
 * Sized up once the filter row landed: a window is now a range *and* a filter,
 * and each filter tap warms three ranges of its own. At the old 16 a user
 * comparing five budgets evicted the unfiltered windows they started from, so
 * clearing the filter went back to the skeleton it had already paid for.
 */
const MaxCachedWindows = 24;

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
  filter,
}: {
  anchor: string;
  period: ActivityPeriod;
  /** The day of the month a budget period begins on. */
  startDay: number;
  search: string;
  /** Budget, category or goal to narrow to, or null for the whole ledger. */
  filter: ActivityFilter | null;
}): ActivityWindowResult {
  const { repo, revision } = useData();

  // The filter's contribution to a cache key, and the only form of it the
  // effect below depends on: two filters with the same string are the same
  // question, whatever object identity says.
  const filterId = filterKey(filter);

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

  const key = windowKey(range, filter, search);
  const prefetchKeys = prefetch.map((entry) => windowKey(entry, filter, search)).join('|');

  useEffect(() => {
    let cancelled = false;

    async function fill(target: DayRange, visible: boolean) {
      const targetKey = windowKey(target, filter, search);
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
            const window = await readWithRetries(() => read(repo, target, filter, search));
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
  }, [repo, revision, key, prefetchKeys, search, filterId]);

  const entry = snapshot.get(key);
  // A miss on the exact key still has something to show if the same *range* was
  // read under a different search term — which is precisely what every keystroke
  // in the search box produces. Holding those rows steady while the narrowed
  // read is in flight is the difference between a list that filters and one that
  // blinks out six times as a word is typed. A miss on the range itself has no
  // such stand-in, and gets the skeleton.
  //
  // The filter is part of the prefix rather than of the tail, so this stand-in
  // never reaches across it. Search narrows a list the user is still typing at
  // and the old rows are a superset of the new ones; a filter tap is a finished
  // question, and answering it with rows from a different budget would be the
  // screen stating something false rather than something stale.
  //
  // A stale entry — the right window, read before the last mutation — is shown
  // for the same reason as search: it is about to be replaced by its own
  // refetch, and announcing that would blank a list the user is looking at.
  const best = entry ?? mostRecentForRange(snapshot, range, filter);

  return { range, window: best?.window };
}

function mostRecentForRange(
  cache: Map<string, CacheEntry>,
  range: DayRange,
  filter: ActivityFilter | null
): CacheEntry | undefined {
  const prefix = `${range.from}:${range.to}:${filterKey(filter)}:`;
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

/** Empty for the unfiltered ledger, so its keys read as they always did. */
function filterKey(filter: ActivityFilter | null): string {
  return filter ? `${filter.kind}=${filter.id}` : '';
}

// Search goes last because it is the only part a stand-in may cross — see
// `mostRecentForRange`, which matches on everything before it.
function windowKey(range: DayRange, filter: ActivityFilter | null, search: string): string {
  return `${range.from}:${range.to}:${filterKey(filter)}:${search}`;
}

async function read(
  repo: Repository,
  range: DayRange,
  filter: ActivityFilter | null,
  search: string
): Promise<ActivityWindow> {
  const bounds = { from: range.from, to: range.to, search: search || undefined };
  const budgetId = filter?.kind === 'budget' ? filter.id : undefined;

  // Three reads rather than one `listActivity` on the repository: expenses,
  // income and goal contributions are separate tables with separate date
  // columns, so a combined read would be these same three queries with the
  // merge moved behind the interface.
  //
  // Each filter kind silences the reads it cannot match, rather than asking for
  // rows already known to be irrelevant. Income has no category — not "an
  // uncategorised one", none at all — and a contribution has neither a budget
  // nor a category, so a goal filter is the only one it can answer.
  const [expenses, incomes, contributions] = await Promise.all([
    filter?.kind === 'goal'
      ? Promise.resolve([])
      : repo.listExpenses({
          ...bounds,
          budgetId,
          categoryId: filter?.kind === 'category' ? filter.id : undefined,
        }),
    filter?.kind === 'category' || filter?.kind === 'goal'
      ? Promise.resolve([])
      : repo.listIncomes({ ...bounds, budgetId }),
    filter?.kind === 'budget' || filter?.kind === 'category'
      ? Promise.resolve([])
      : repo.listContributions({
          ...bounds,
          goalId: filter?.kind === 'goal' ? filter.id : undefined,
        }),
  ]);

  return { expenses, incomes, contributions };
}

/** Oldest insertion first, which is also least-recently-fetched. */
function evict(cache: Map<string, CacheEntry>) {
  while (cache.size > MaxCachedWindows) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}
