/**
 * Activity — the ledger, both directions, filterable by day or budget period.
 *
 * Income lives here rather than on a screen of its own because the question the
 * list answers is "what happened to my money", and a paycheck is half that
 * answer. Money moved into a savings goal is here for the same reason and a
 * sharper one: it leaves the spendable balance without being spent, so without
 * a row for it Home's "Left" drops by a few hundred with nothing anywhere to
 * account for it.
 *
 * Search is the cheap stand-in for asking "how much do I spend on coffee"
 * without forcing a category on every entry. It matches an expense's
 * description, an income's source and a movement's note — the free-text field
 * on each of the three.
 *
 * The filter row underneath answers the same question for the entries that
 * *are* filed: one budget, one goal or one category at a time, with the summary
 * above narrowing along with the list, so the header always totals exactly what
 * is on screen.
 */

import { useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityFilterBar } from '@/components/activity-filter-bar';
import { ActivityRow } from '@/components/activity-row';
import { PeriodNav } from '@/components/period-nav';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Chip } from '@/components/ui/chip';
import { ChartInk } from '@/constants/palette';
import { BottomTabInset, FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import type { ActivityEntry } from '@/db/types';
import {
  useActivityWindow,
  type ActivityFilter,
  type ActivityPeriod,
} from '@/hooks/use-activity-window';
import { useIsWide } from '@/hooks/use-is-wide';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import {
  addDays,
  addPeriods,
  DefaultPeriodStartDay,
  formatDayLabel,
  formatPeriodLabel,
  periodRange,
  today,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';

type Period = ActivityPeriod;

/** The local calendar day an entry falls on, whichever kind it is. */
function entryDay(entry: ActivityEntry): string {
  if (entry.kind === 'expense') return entry.spentOn;
  if (entry.kind === 'income') return entry.receivedOn;
  return entry.movedOn;
}

/**
 * What an entry did to the spendable balance, signed.
 *
 * The one rule the day totals and the section headers both run on: income adds,
 * an expense subtracts, and a movement into a goal subtracts exactly as an
 * expense does. Money set aside has left the balance — it simply hasn't been
 * spent, which is a distinction the *summary* above draws and an individual
 * day's net cannot.
 */
function entryEffect(entry: ActivityEntry): number {
  if (entry.kind === 'income') return entry.amountMinor;
  if (entry.kind === 'expense') return -entry.amountMinor;
  return entry.direction === 'in' ? -entry.amountMinor : entry.amountMinor;
}

export default function ActivityScreen() {
  const theme = useTheme();
  const wide = useIsWide();
  const scheme = useScheme();
  const { preferences, budgets, categories, goals } = useData();

  const [period, setPeriod] = useState<Period>('period');
  const [anchor, setAnchor] = useState(today());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ActivityFilter | null>(null);

  // The ledger spans the same window as the budgets do, so a period's totals
  // here and the bars on Home can be read against each other.
  const startDay = preferences.periodStartDay;
  const calendarMonths = startDay === DefaultPeriodStartDay;

  // What the active filter is *called*. Read from the cached slices rather than
  // carried in the filter itself, so renaming a budget doesn't leave a stale
  // name pinned in this screen's state.
  const filterName =
    filter === null
      ? null
      : (filter.kind === 'budget'
          ? budgets.find((budget) => budget.id === filter.id)?.name
          : filter.kind === 'goal'
            ? goals.find((goal) => goal.id === filter.id)?.name
            : categories.find((category) => category.id === filter.id)?.name) ?? null;

  // Deleting a budget, goal or category doesn't reach into this screen's state,
  // so a filter can outlive the thing it names — and expenses keep pointing at a
  // tombstoned budget, so the narrowed read would still return rows. Resolving
  // the filter against the live slices means it stops applying instead, which
  // is the same thing the chip row shows once the chip is gone.
  const activeFilter = filterName === null ? null : filter;

  // The window the user is on, with the ones on either side of it already read
  // — see hooks/use-activity-window.ts for why stepping used to feel like a
  // wait and no longer does.
  const { range, window: activity } = useActivityWindow({
    anchor,
    period,
    startDay,
    search: search.trim(),
    filter: activeFilter,
  });

  const expenses = activity?.expenses;
  const incomes = activity?.incomes;
  const contributions = activity?.contributions;

  const entries = useMemo<ActivityEntry[]>(() => {
    const merged: ActivityEntry[] = [
      ...(expenses ?? []).map((expense) => ({ kind: 'expense' as const, ...expense })),
      ...(incomes ?? []).map((income) => ({ kind: 'income' as const, ...income })),
      ...(contributions ?? []).map((contribution) => ({
        kind: 'contribution' as const,
        ...contribution,
      })),
    ];

    // Newest first, with `createdAt` breaking ties so two entries on the same
    // day keep a stable order instead of shuffling on every refetch.
    return merged.sort((a, b) => {
      const byDay = entryDay(b).localeCompare(entryDay(a));
      return byDay !== 0 ? byDay : b.createdAt.localeCompare(a.createdAt);
    });
  }, [expenses, incomes, contributions]);

  const sections = useMemo(() => groupByDay(entries), [entries]);

  const inMinor = (incomes ?? []).reduce((sum, income) => sum + income.amountMinor, 0);
  const outMinor = (expenses ?? []).reduce((sum, expense) => sum + expense.amountMinor, 0);
  // Net into goals, kept out of `outMinor` on purpose: setting money aside is
  // not spending it, and a summary that added the two would report a bad month
  // to someone who had a disciplined one.
  const savedMinor = (contributions ?? []).reduce(
    (sum, entry) => sum + (entry.direction === 'in' ? entry.amountMinor : -entry.amountMinor),
    0
  );

  function step(direction: -1 | 1) {
    if (period === 'day') {
      setAnchor(addDays(anchor, direction));
      return;
    }
    setAnchor(addPeriods(anchor, startDay, direction));
  }

  const periodLabel =
    period === 'day' ? formatDayLabel(anchor) : formatPeriodLabel(range.from, range.to);
  // Compared on the period's *start*, not on a month key: with a custom start
  // day two dates in the same calendar month can belong to different periods.
  const atPresent =
    period === 'day' ? anchor >= today() : range.from >= periodRange(today(), startDay).start;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={[styles.safeArea, wide && styles.wideSafeArea]} edges={['top']}>
        <View style={[styles.header, wide && styles.wideHeader]}>
          <View style={styles.periodToggle}>
            <Chip label="Day" selected={period === 'day'} onPress={() => setPeriod('day')} />
            {/* "Month" only while a period *is* a month — otherwise the chip
                would name a span it no longer covers. */}
            <Chip
              label={calendarMonths ? 'Month' : 'Period'}
              selected={period === 'period'}
              onPress={() => setPeriod('period')}
            />

            {/* The way back from a long traversal. Stepping is one period at a
                time by design — it's how you read a ledger — but that makes
                "back to now" cost as many taps as you spent getting away from
                it. Shown only while it has somewhere to go, so the present
                never carries a control that would do nothing. */}
            {!atPresent && (
              <Animated.View
                entering={FadeIn.duration(140)}
                exiting={FadeOut.duration(140)}
                style={styles.jumpToPresent}>
                <Chip
                  label={period === 'day' ? 'Today' : calendarMonths ? 'This month' : 'Now'}
                  onPress={() => setAnchor(today())}
                />
              </Animated.View>
            )}
          </View>

          {/* The jump-back chip lives up in the toggle row rather than in the
              stepper's own slot for it: that row is always drawn, so the chip
              coming and going moves nothing. "in" and "out" are spelled out
              rather than signed, so the summary doesn't need the same sign
              convention as the rows to be read correctly at a glance — and it's
              held back until the window has actually been read, because an
              unfilled total is zero and zero is a number the user would
              believe. */}
          <PeriodNav
            label={periodLabel}
            subtitle={
              activity
                ? [
                    `${formatMoney(inMinor, preferences.currencyCode)} in`,
                    `${formatMoney(outMinor, preferences.currencyCode)} out`,
                    // Only when the window actually moved money to or from a
                    // goal. On an account that has never used them this line
                    // stays the two figures it has always been.
                    savedMinor !== 0 &&
                      `${formatMoney(Math.abs(savedMinor), preferences.currencyCode)} ${
                        savedMinor > 0 ? 'set aside' : 'back out'
                      }`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '—'
            }
            onPrev={() => step(-1)}
            onNext={atPresent ? undefined : () => step(1)}
          />

          <View style={[styles.searchWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search descriptions and sources"
              placeholderTextColor={theme.textSecondary}
              style={[styles.search, { color: theme.text }]}
              clearButtonMode="while-editing"
              autoCorrect={false}
              accessibilityLabel="Search activity"
            />
          </View>

          <ActivityFilterBar
            budgets={budgets}
            goals={goals}
            categories={categories}
            filter={activeFilter}
            onChange={setFilter}
          />
        </View>

        {/* Only when there is nothing at all to draw. A window being *refined*
            — a search narrowing, a mutation refetching — keeps its rows. */}
        {!activity ? (
          <LedgerSkeleton />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => `${item.kind}:${item.id}`}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <ThemedText type="label" themeColor="textSecondary">
                  {formatDayLabel(section.dayKey)}
                </ThemedText>
                {/* The day's net effect on the spendable balance, signed,
                    because a day can hold all three kinds and a bare total
                    would hide two of them. */}
                <ThemedText
                  type="label"
                  themeColor="textSecondary"
                  style={[
                    styles.sectionTotal,
                    section.netMinor > 0 && { color: ChartInk[scheme].good },
                  ]}>
                  {section.netMinor > 0 ? '+' : section.netMinor < 0 ? '−' : ''}
                  {formatMoney(Math.abs(section.netMinor), preferences.currencyCode)}
                </ThemedText>
              </View>
            )}
            renderItem={({ item }) => (
              <ActivityRow entry={item} currencyCode={preferences.currencyCode} />
            )}
            ListEmptyComponent={
              <ThemedText type="label" themeColor="textSecondary" style={styles.empty}>
                {emptyMessage(search.trim(), filterName)}
              </ThemedText>
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * Why the list is empty, naming every narrowing that is actually on.
 *
 * An empty period reads as "you logged nothing", which is a different message
 * from "nothing here matches what you asked for" — and with two narrowings
 * available, a message that named only one would send the user hunting for a
 * filter they had already cleared.
 */
function emptyMessage(search: string, filterName: string | null): string {
  const scope = filterName ? ` in ${filterName}` : '';
  if (search) return `Nothing matching “${search}”${scope} this period.`;
  return filterName ? `Nothing${scope} this period.` : 'Nothing logged in this period yet.';
}

/**
 * What the list shows on a genuine cache miss — the first visit to a window,
 * or a traversal faster than the prefetch can keep up with.
 *
 * Rows rather than a spinner: the shape of what is coming is already known, and
 * drawing it means the real rows land *into* the layout instead of pushing a
 * centred spinner out of the way. The pulse is what separates "loading" from
 * "these are your entries, greyed out" — without it, placeholder rows read as
 * disabled content.
 */
function LedgerSkeleton() {
  const theme = useTheme();
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.85, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.list, style]} pointerEvents="none" accessibilityLabel="Loading">
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={[styles.skeletonDisc, { backgroundColor: theme.backgroundSelected }]} />
          <View style={styles.skeletonText}>
            {/* Widths alternate so the block reads as a list of unlike entries
                rather than as a table someone forgot to fill in. */}
            <View
              style={[
                styles.skeletonLine,
                { backgroundColor: theme.backgroundSelected, width: index % 2 ? '52%' : '68%' },
              ]}
            />
            <View
              style={[
                styles.skeletonLine,
                styles.skeletonLineShort,
                { backgroundColor: theme.backgroundSelected },
              ]}
            />
          </View>
          <View style={[styles.skeletonAmount, { backgroundColor: theme.backgroundSelected }]} />
        </View>
      ))}
    </Animated.View>
  );
}

interface DaySection {
  dayKey: string;
  /** What the day did to the spendable balance — see {@link entryEffect}. */
  netMinor: number;
  data: ActivityEntry[];
}

/** Entries arrive newest-first from the merge, so insertion order is right. */
function groupByDay(entries: ActivityEntry[]): DaySection[] {
  const byDay = new Map<string, DaySection>();

  for (const entry of entries) {
    const dayKey = entryDay(entry);
    const section = byDay.get(dayKey) ?? { dayKey, netMinor: 0, data: [] };

    section.netMinor += entryEffect(entry);
    section.data.push(entry);
    byDay.set(dayKey, section);
  }

  return [...byDay.values()];
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  // A ledger stays one readable column on a wide screen — it is read down, not
  // across — so the wide layout only gives it room to breathe.
  wideSafeArea: {
    maxWidth: 800,
  },
  wideHeader: {
    paddingTop: Spacing.five,
  },
  periodToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  jumpToPresent: {
    marginLeft: 'auto',
  },
  searchWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  search: {
    ...FieldText,
    paddingVertical: 12,
  },
  list: {
    // Deliberately no horizontal padding: the rows are swipeable, and the red
    // delete block behind them has to reach the screen edge. Everything in the
    // list insets itself instead — see `row` in components/activity-row.tsx.
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  sectionTotal: {
    fontVariant: ['tabular-nums'],
  },
  // Mirrors `row` in components/activity-row.tsx, so the real rows land where
  // the placeholders were rather than an inch off.
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  // The 34pt disc `GlyphDisc` defaults to, at the same third-of-its-size radius.
  skeletonDisc: {
    width: 34,
    height: 34,
    borderRadius: 34 / 3,
  },
  skeletonText: {
    flex: 1,
    gap: Spacing.one + 2,
  },
  skeletonLine: {
    height: 11,
    borderRadius: Spacing.one,
  },
  skeletonLineShort: {
    width: '34%',
    height: 9,
  },
  skeletonAmount: {
    width: 62,
    height: 11,
    borderRadius: Spacing.one,
  },
  empty: {
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.three,
    textAlign: 'center',
  },
});
