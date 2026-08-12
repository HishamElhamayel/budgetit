/**
 * Home — greeting, the amount hero, then the charts it feeds.
 *
 * The loop this screen exists to close: type an amount at the top, and the
 * charts below redraw before you've put the phone down. That works without any
 * explicit wiring because every chart reads through `useQuery`, which re-runs
 * on each mutation (see data/store.tsx).
 */

import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetTabStrip } from '@/components/budget-tab-strip';
import { BudgetBars } from '@/components/charts/budget-bars';
import { DonutChart } from '@/components/charts/donut-chart';
import { ExpenseForm } from '@/components/expense-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { ChartInk } from '@/constants/palette';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData, useQuery } from '@/data/store';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { DefaultPeriodStartDay, formatPeriodLabel, periodRange, today } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { greetingName, timeOfDayGreeting } from '@/lib/name';

export default function HomeScreen() {
  const { budgets, categories, preferences, profile, ready, mutate } = useData();
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);

  // Null for accounts that predate the name being asked for, which is what the
  // greeting line is conditional on — a "Good evening," with nothing after it
  // is worse than no greeting.
  const name = greetingName(profile?.fullName);

  const day = today();
  // The user's pay cycle, not the calendar's. Everything on this screen spans
  // the same window as the budget bars below it, so "left" and "spent" are
  // answers to the same question.
  const { start: periodStart, end: periodEnd } = periodRange(day, preferences.periodStartDay);
  const calendarMonths = preferences.periodStartDay === DefaultPeriodStartDay;

  const { data: categoryTotals } = useQuery(
    (repo) =>
      repo.categoryTotals({
        from: periodStart,
        to: periodEnd,
        budgetId: selectedBudgetId ?? undefined,
      }),
    [periodStart, periodEnd, selectedBudgetId]
  );

  const { data: progress } = useQuery((repo) => repo.budgetProgress(day), [day]);

  // Whole-period flow, deliberately unfiltered by the selected budget: income
  // often isn't tagged to a pot at all, so a filtered "left" would routinely
  // read as negative and mean nothing.
  const { data: flow } = useQuery((repo) => repo.monthFlow(periodStart, periodEnd), [
    periodStart,
    periodEnd,
  ]);

  // Keyed off the completion flag rather than `budgets.length === 0`: onboarding
  // finishes with `router.replace('/')`, and a count-based check can still see
  // zero budgets on the first frame back here. The flag is written in the same
  // transaction as the budgets, so it can't disagree with them.
  if (ready && !preferences.onboardingCompletedAt) {
    return <Redirect href="/onboarding" />;
  }

  const visibleProgress = selectedBudgetId
    ? (progress ?? []).filter((entry) => entry.budget.id === selectedBudgetId)
    : (progress ?? []);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
            <View style={styles.header}>
              {name && (
                <ThemedText type="label" themeColor="textSecondary">
                  {timeOfDayGreeting()}, {name}
                </ThemedText>
              )}
              <ThemedText type="title">What did you spend?</ThemedText>
            </View>

            <BudgetTabStrip
              budgets={budgets}
              selectedId={selectedBudgetId}
              onSelect={setSelectedBudgetId}
            />

            <View style={styles.body}>
              <Card>
                <ExpenseForm
                  budgets={budgets}
                  categories={categories}
                  activeBudgetId={selectedBudgetId ?? budgets[0]?.id ?? null}
                  onSubmit={async (input) => {
                    await mutate((repo) => repo.createExpense(input));
                  }}
                />
              </Card>

              <ThemedText type="label" themeColor="textSecondary" style={styles.sectionLabel}>
                {formatPeriodLabel(periodStart, periodEnd)}
              </ThemedText>

              <Card>
                <View style={styles.flowRow}>
                  <FlowStat label="In" minor={flow?.inMinor ?? 0} currencyCode={preferences.currencyCode} />
                  <FlowStat label="Out" minor={flow?.outMinor ?? 0} currencyCode={preferences.currencyCode} />
                  {/*
                    "Left", not "Net": what's on the card is the running balance,
                    so a month where nothing came in still shows the surplus that
                    rolled in from the last one rather than a bare minus figure.
                  */}
                  <FlowStat
                    label="Left"
                    minor={flow?.availableMinor ?? 0}
                    currencyCode={preferences.currencyCode}
                    signed
                  />
                </View>

                {/*
                  Only when there is something to carry. A "+$0.00 carried over"
                  on a first-month account is a line explaining a feature the
                  user hasn't used yet.
                */}
                {!!flow?.openingMinor && (
                  <CarriedLine
                    minor={flow.openingMinor}
                    currencyCode={preferences.currencyCode}
                    periodWord={calendarMonths ? 'months' : 'periods'}
                  />
                )}
              </Card>

              <Card title="Where it went">
                <DonutChart
                  totals={categoryTotals ?? []}
                  currencyCode={preferences.currencyCode}
                  centerLabel={
                    selectedBudgetId ? 'this budget' : calendarMonths ? 'this month' : 'this period'
                  }
                />
              </Card>

              <Card title="Budgets">
                {visibleProgress.length === 0 ? (
                  <ThemedText type="label" themeColor="textSecondary">
                    No budgets to show.
                  </ThemedText>
                ) : (
                  <BudgetBars progress={visibleProgress} currencyCode={preferences.currencyCode} />
                )}
              </Card>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * One figure in the in/out/net row. Only `net` is signed and coloured — In and
 * Out are positive by definition, so a colour on them would be decoration.
 */
function FlowStat({
  label,
  minor,
  currencyCode,
  signed = false,
}: {
  label: string;
  minor: number;
  currencyCode: string;
  signed?: boolean;
}) {
  const scheme = useScheme();
  const ink = ChartInk[scheme];
  const tone = !signed || minor === 0 ? undefined : minor > 0 ? ink.good : ink.critical;

  return (
    <View style={styles.flowStat}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="heading" style={tone ? { color: tone } : undefined}>
        {signed && minor > 0 ? '+' : ''}
        {formatMoney(minor, currencyCode)}
      </ThemedText>
    </View>
  );
}

/**
 * What last month left behind, spelled out under the figures.
 *
 * Without it "Left" is unexplainable arithmetic: In minus Out doesn't equal it,
 * and the user is left to guess where the difference came from. Deliberately
 * "earlier months" rather than the previous month by name — the balance is
 * cumulative over all history, and naming July would be wrong for anyone who
 * also had something left in June.
 */
function CarriedLine({
  minor,
  currencyCode,
  periodWord,
}: {
  minor: number;
  currencyCode: string;
  periodWord: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const ink = ChartInk[scheme];

  return (
    <View style={[styles.carried, { borderTopColor: theme.border }]}>
      <ThemedText type="label" themeColor="textSecondary">
        <ThemedText
          type="label"
          style={{ color: minor > 0 ? ink.good : ink.critical }}>
          {minor > 0 ? '+' : ''}
          {formatMoney(minor, currencyCode)}
        </ThemedText>{' '}
        carried over from earlier {periodWord}
      </ThemedText>
    </View>
  );
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
  flex: {
    flex: 1,
  },
  content: {
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.four,
  },
  header: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.one,
  },
  body: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  sectionLabel: {
    paddingTop: Spacing.three,
  },
  flowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  flowStat: {
    flex: 1,
    gap: Spacing.half,
  },
  carried: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
});
