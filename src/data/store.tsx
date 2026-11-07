/**
 * The reactivity layer.
 *
 * This is what makes the core loop work: log an expense, and every chart on
 * screen updates without anyone wiring up a refresh. There are no live queries
 * against Supabase here, so instead the provider holds a `revision` counter
 * that every mutation bumps, and `useQuery` re-runs whenever it changes.
 *
 * Refetching everything on every write is knowingly brute-force. It is also
 * correct by construction and cheap at this data size — a year of daily logging
 * is a few thousand rows. Revisit only if profiling says so.
 *
 * The provider sits below {@link AuthProvider} and is keyed on the signed-in
 * user: when the session changes, `repo` is rebuilt and every cached slice
 * reloads, so signing in as someone else cannot leave the previous account's
 * budgets on screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react';

import { useAuth } from '@/data/auth';
import type { Repository } from '@/data/repository';
import { createSupabaseRepository, DEFAULT_PREFERENCES } from '@/data/supabase-repository';
import type { Budget, Category, Goal, Preferences, Profile } from '@/db/types';
import { supabase } from '@/lib/supabase';

/**
 * Stands in for the repository while nobody is signed in.
 *
 * No gated screen renders without a session, so in practice nothing calls this.
 * It exists so `repo` can stay non-nullable — the alternative is a null check
 * in `useQuery` and in every screen, to defend against a state those screens
 * are never mounted in. Rejecting loudly beats returning empty results, which
 * would look like "your data is gone" rather than like a bug.
 */
const SIGNED_OUT_REPOSITORY = new Proxy({} as Repository, {
  get(_target, property) {
    return () =>
      Promise.reject(new Error(`Repository.${String(property)}() called while signed out`));
  },
});

/**
 * How many times a failed read is retried, and the base delay between attempts
 * (multiplied by the attempt number, so 0.7s then 1.4s).
 *
 * Sized for one failure in particular: a token minted a moment ago comes back
 * rejected as `JWT issued at future` when the node validating it is running a
 * second or so behind the one that signed it. That heals itself almost
 * immediately, and retrying quietly is better than making the user tap
 * anything for it.
 *
 * Used by every reader in the app — the cached slices in `load`, every live
 * `useQuery`, and the windowed reads in `useActivityWindow`. They have to
 * agree: they run against the same token at the same moment, so a policy that
 * covers one and not the other shows up as a screen where half the data
 * arrived.
 */
const LOAD_ATTEMPTS = 3;
const LOAD_RETRY_DELAY_MS = 700;

/**
 * Run a read under the retry policy above, rethrowing once the attempts are
 * spent.
 *
 * `cancelled` is checked before each sleep as well as after, so a screen that
 * unmounted mid-flight stops here rather than holding the closure alive for
 * another two seconds to answer a question nobody asked. It reports the
 * cancellation by throwing, which callers already have to handle — they simply
 * check their own flag before touching state.
 */
export async function readWithRetries<T>(
  run: () => Promise<T>,
  cancelled: () => boolean = () => false
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (cancelled() || attempt >= LOAD_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_DELAY_MS * attempt));
      if (cancelled()) throw error;
    }
  }
}

interface DataContextValue {
  repo: Repository;
  revision: number;
  /** Run a write and refresh every live query. */
  mutate: <T>(work: (repo: Repository) => Promise<T>) => Promise<T>;
  /** Cached because nearly every screen needs them and they change rarely. */
  budgets: Budget[];
  categories: Category[];
  goals: Goal[];
  preferences: Preferences;
  /**
   * Null only while signed out or mid-load. Every gated screen renders behind
   * `ready`, so screens can treat it as present — but it is typed nullable
   * rather than defaulted, because a blank profile and a not-yet-loaded one
   * would otherwise be the same object and the account screen would show empty
   * fields as though the server had answered.
   */
  profile: Profile | null;
  ready: boolean;
  /**
   * Set when the cached slices could not be filled, after the retries above
   * are spent. Distinct from `!ready`, which is also true while a load is in
   * flight — this one means it stopped, and something has to offer a way out.
   */
  loadError: Error | null;
  /** Retry a failed load. */
  reload: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, initialising } = useAuth();
  const userId = user?.id ?? null;

  // Rebuilt whenever the account changes. Every downstream `useQuery` lists
  // `repo` in its dependencies, so a new identity here refetches the lot.
  const repo = useMemo(
    () => (userId ? createSupabaseRepository(supabase, userId) : SIGNED_OUT_REPOSITORY),
    [userId]
  );

  const [revision, setRevision] = useState(0);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [profile, setProfile] = useState<Profile | null>(null);
  /**
   * Which account the cached slices above were last filled from, or `null` for
   * "filled from nobody" — the signed-out defaults.
   *
   * Recorded rather than kept as a plain `ready` boolean because a boolean can
   * only latch. Signing out settles it to true, and it then stays true across
   * the following sign-in for as long as the new account's read is in flight —
   * during which every consumer sees `ready` alongside the *defaults*. That is
   * not a cosmetic flash: Home reads `preferences.onboardingCompletedAt` on its
   * first render to decide whether to redirect, so a returning user was sent
   * back through setup they had already finished. Cold start hid it, because
   * there `ready` starts false and the splash holds until the read lands.
   */
  const [loadedFor, setLoadedFor] = useState<{ userId: string | null } | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  // Settled *and* about the account that is signed in right now. Comparing the
  // two ids is what makes this go false the instant `userId` changes, with no
  // window for a stale answer — and, because a mutation reloads the same
  // account, it stays true right through `mutate`, so logging an expense
  // doesn't blank the screen.
  const ready = !initialising && loadedFor !== null && loadedFor.userId === userId;

  const load = useCallback(async () => {
    // Signed out is a legitimate settled state, not a loading one: the sign-in
    // screen needs `ready` to go true or the splash never lifts. Clearing the
    // slices on the way through is what stops the previous account's budgets
    // flashing up behind the sign-in form.
    if (!userId) {
      setBudgets([]);
      setCategories([]);
      setGoals([]);
      setPreferences(DEFAULT_PREFERENCES);
      setProfile(null);
      setLoadedFor({ userId: null });
      setLoadError(null);
      return;
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        const [nextBudgets, nextCategories, nextGoals, nextPreferences, nextProfile] =
          await Promise.all([
            repo.listBudgets(),
            repo.listCategories(),
            repo.listGoals(),
            repo.getPreferences(),
            repo.getProfile(),
          ]);

        setBudgets(nextBudgets);
        setCategories(nextCategories);
        setGoals(nextGoals);
        setPreferences(nextPreferences);
        setProfile(nextProfile);
        setLoadedFor({ userId });
        setLoadError(null);
        return;
      } catch (error) {
        if (attempt < LOAD_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_DELAY_MS * attempt));
          continue;
        }

        console.error('[budgetit] load failed', error);
        // `loadedFor` is deliberately left alone. Settling it here would make
        // `ready` true alongside the *defaults*, and Home reads
        // `preferences.onboardingCompletedAt` on its first render — a returning
        // user would be pushed back through setup because one request failed.
        // The root navigator watches `loadError` and offers a retry instead.
        setLoadError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }, [repo, userId]);

  useEffect(() => {
    // The initial read. `load` only calls setState after awaiting the database,
    // so nothing here is a synchronous set — the lint rule can't see through
    // the function boundary to tell. This is the "subscribe to an external
    // system" case the rule explicitly allows.
    //
    // `void` is safe because `load` handles its own failures: an unhandled
    // rejection here would surface as a red box in dev and, worse, leave
    // `ready` false forever with nothing left to lift the splash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const reload = useCallback(() => {
    setLoadError(null);
    void load();
  }, [load]);

  const mutate = useCallback(
    async <T,>(work: (repo: Repository) => Promise<T>): Promise<T> => {
      const result = await work(repo);

      // Reload the cached slices *before* resolving, so `await mutate(...)`
      // means "the write landed and this provider already reflects it".
      //
      // This matters more than it looks. Callers routinely navigate straight
      // after a mutation — onboarding does `await mutate(...)` then
      // `router.replace('/')` — and the destination reads `budgets` and
      // `preferences` on its very first render to decide whether to redirect.
      // If the reload were left to fire asynchronously, that render would see
      // pre-write state and bounce the user back where they came from.
      await load();

      // Bumps the live queries, which own their own results and can refresh
      // independently of the cached slices above.
      setRevision((current) => current + 1);
      return result;
    },
    [repo, load]
  );

  const value = useMemo<DataContextValue>(
    () => ({
      repo,
      revision,
      mutate,
      budgets,
      categories,
      goals,
      preferences,
      profile,
      ready,
      loadError,
      reload,
    }),
    [
      repo,
      revision,
      mutate,
      budgets,
      categories,
      goals,
      preferences,
      profile,
      ready,
      loadError,
      reload,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside <DataProvider>');
  return value;
}

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
}

/**
 * Run a read against the repository, re-running it whenever `deps` change or
 * any mutation lands.
 *
 * `run` is deliberately excluded from the dependency list — it is redefined on
 * every render, and including it would loop forever. Put anything the query
 * reads into `deps` instead, the same contract as `useEffect`.
 */
export function useQuery<T>(run: (repo: Repository) => Promise<T>, deps: DependencyList): QueryResult<T> {
  const { repo, revision } = useData();

  // Data and loading live in one state object so a settled query is a single
  // update rather than two, and so the previous result stays on screen while a
  // refetch is in flight — that's what stops the charts flashing empty every
  // time an expense is logged.
  const [state, setState] = useState<QueryResult<T>>({ data: undefined, loading: true });

  // The latest-ref pattern. Declared before the query effect so it has already
  // run by the time the query fires; assigning during render would be a write
  // to a ref in render, which React (rightly) disallows.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setState((previous) => ({ ...previous, loading: true }));

      // The same bounded retry the cached slices get, for the same reason and
      // on the same schedule. Without it the two halves of this file disagree
      // about a failure they both see: a sign-in mints a token, the clock skew
      // described at LOAD_ATTEMPTS rejects the first request made with it, and
      // `load` quietly recovers while every chart on the screen gives up. The
      // visible result was an empty donut next to a populated budget list, with
      // nothing to retry it until the next mutation happened to bump `revision`.
      try {
        const result = await readWithRetries(
          () => runRef.current(repo),
          () => cancelled
        );
        if (!cancelled) setState({ data: result, loading: false });
      } catch (error) {
        if (cancelled) return;
        console.error('[budgetit] query failed', error);
        setState((previous) => ({ ...previous, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, revision, ...deps]);

  return state;
}
