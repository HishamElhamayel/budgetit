/**
 * Activity — the ledger, both directions, filterable by day or month.
 *
 * Income lives here rather than on a screen of its own because the question the
 * list answers is "what happened to my money", and a paycheck is half that
 * answer. Keeping them apart also left income with no route to reach it: the
 * edit screen exists, but nothing linked to it.
 *
 * Search is the cheap stand-in for asking "how much do I spend on coffee"
 * without forcing a category on every entry. It matches an expense's
 * description and an income's source — the free-text field on each side.
 */

import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityRow } from '@/components/activity-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Chip } from '@/components/ui/chip';
import { ChartInk } from '@/constants/palette';
import { BottomTabInset, FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData, useQuery } from '@/data/store';
import type { ActivityEntry } from '@/db/types';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import {
  addDays,
  endOfMonth,
  formatDayLabel,
  formatMonthLabel,
  startOfMonth,
  today,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';

type Period = 'day' | 'month';

/** The local calendar day an entry falls on, whichever kind it is. */
function entryDay(entry: ActivityEntry): string {
  return entry.kind === 'expense' ? entry.spentOn : entry.receivedOn;
}

export default function ActivityScreen() {
  const theme = useTheme();
  const scheme = useScheme();
  const { preferences } = useData();

  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(today());
  const [search, setSearch] = useState('');

  const range = useMemo(
    () =>
      period === 'day'
        ? { from: anchor, to: anchor }
        : { from: startOfMonth(anchor), to: endOfMonth(anchor) },
    [period, anchor]
  );

  // Two reads merged here rather than one `listActivity` on the repository.
  // Expenses and income are separate tables with separate date columns, so a
  // combined read would be the same two queries with the merge moved behind the
  // interface — and the interface would then owe callers a sort order it can't
  // express in either table.
  const { data: expenses } = useQuery(
    (repo) => repo.listExpenses({ ...range, search: search.trim() || undefined }),
    [range.from, range.to, search]
  );

  const { data: incomes } = useQuery(
    (repo) => repo.listIncomes({ ...range, search: search.trim() || undefined }),
    [range.from, range.to, search]
  );

  const entries = useMemo<ActivityEntry[]>(() => {
    const merged: ActivityEntry[] = [
      ...(expenses ?? []).map((expense) => ({ kind: 'expense' as const, ...expense })),
      ...(incomes ?? []).map((income) => ({ kind: 'income' as const, ...income })),
    ];

    // Newest first, with `createdAt` breaking ties so two entries on the same
    // day keep a stable order instead of shuffling on every refetch.
    return merged.sort((a, b) => {
      const byDay = entryDay(b).localeCompare(entryDay(a));
      return byDay !== 0 ? byDay : b.createdAt.localeCompare(a.createdAt);
    });
  }, [expenses, incomes]);

  const sections = useMemo(() => groupByDay(entries), [entries]);

  const inMinor = (incomes ?? []).reduce((sum, income) => sum + income.amountMinor, 0);
  const outMinor = (expenses ?? []).reduce((sum, expense) => sum + expense.amountMinor, 0);

  function step(direction: -1 | 1) {
    if (period === 'day') {
      setAnchor(addDays(anchor, direction));
      return;
    }
    // Step a whole month by landing on the 1st and moving one day past the edge.
    const first = startOfMonth(anchor);
    setAnchor(direction === -1 ? startOfMonth(addDays(first, -1)) : addDays(endOfMonth(first), 1));
  }

  const periodLabel =
    period === 'day' ? formatDayLabel(anchor) : formatMonthLabel(anchor.slice(0, 7));
  const atPresent = period === 'day' ? anchor >= today() : anchor.slice(0, 7) >= today().slice(0, 7);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.periodToggle}>
            <Chip label="Day" selected={period === 'day'} onPress={() => setPeriod('day')} />
            <Chip label="Month" selected={period === 'month'} onPress={() => setPeriod('month')} />
          </View>

          <View style={styles.navRow}>
            <ThemedText
              type="title"
              themeColor="textSecondary"
              accessibilityRole="button"
              accessibilityLabel="Previous period"
              style={styles.navArrow}
              onPress={() => step(-1)}>
              ‹
            </ThemedText>

            <View style={styles.navLabel}>
              <ThemedText type="label">{periodLabel}</ThemedText>
              {/* "in" and "out" spelled out rather than signed, so the summary
                  doesn't need the same sign convention as the rows to be read
                  correctly at a glance. */}
              <ThemedText type="label" themeColor="textSecondary">
                {formatMoney(inMinor, preferences.currencyCode)} in ·{' '}
                {formatMoney(outMinor, preferences.currencyCode)} out
              </ThemedText>
            </View>

            <ThemedText
              type="title"
              themeColor="textSecondary"
              accessibilityRole="button"
              accessibilityLabel="Next period"
              style={[styles.navArrow, atPresent && styles.navArrowDisabled]}
              onPress={atPresent ? undefined : () => step(1)}>
              ›
            </ThemedText>
          </View>

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
        </View>

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
              {/* The day's net, signed, because a day can now hold both
                  directions and a bare total would hide one of them. */}
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
              {search.trim()
                ? `Nothing matching “${search.trim()}” in this period.`
                : 'Nothing logged in this period yet.'}
            </ThemedText>
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

interface DaySection {
  dayKey: string;
  /** Income less expenses for the day. */
  netMinor: number;
  data: ActivityEntry[];
}

/** Entries arrive newest-first from the merge, so insertion order is right. */
function groupByDay(entries: ActivityEntry[]): DaySection[] {
  const byDay = new Map<string, DaySection>();

  for (const entry of entries) {
    const dayKey = entryDay(entry);
    const section = byDay.get(dayKey) ?? { dayKey, netMinor: 0, data: [] };

    section.netMinor += entry.kind === 'income' ? entry.amountMinor : -entry.amountMinor;
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
  periodToggle: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  navArrow: {
    paddingHorizontal: Spacing.two,
  },
  navArrowDisabled: {
    opacity: 0.25,
  },
  navLabel: {
    flex: 1,
    alignItems: 'center',
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
  empty: {
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.three,
    textAlign: 'center',
  },
});
