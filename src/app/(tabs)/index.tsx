/**
 * Home — greeting, the amount hero, then the charts it feeds.
 *
 * The loop this screen exists to close: type an amount at the top, and the
 * charts below redraw before you've put the phone down. That works without any
 * explicit wiring because every chart reads through `useQuery`, which re-runs
 * on each mutation (see data/store.tsx).
 *
 * Everything below the form is one window on that data, and the window steps:
 * the period the charts cover is state here rather than always being the
 * current one. Two things follow from that and are worth keeping true.
 *
 * The form stays fixed to the present while the charts move. It is an input,
 * not a view — logging into July because you happened to be *looking* at July
 * would be the screen deciding a date the user never chose. It has its own date
 * chips for that. The window follows the entry instead: submit something that
 * lands outside what's on screen and the charts step to meet it, so the loop
 * above still closes wherever the user had wandered to.
 *
 * And the past is not the present with older numbers in it. "3 days left" is a
 * fact about now, so the bars drop it once the window is historical rather than
 * counting down to a date that has already passed.
 *
 * The two pot-shaped cards at the bottom are deliberately a pair, in this order:
 * budgets are money on its way out, goals are money held back from going out.
 * Both read against "Left" directly above them, which is what makes that figure
 * legible — it is what remains after the spending *and* after the saving.
 */

import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetTabStrip } from '@/components/budget-tab-strip';
import { BudgetBars } from '@/components/charts/budget-bars';
import { DonutChart } from '@/components/charts/donut-chart';
import { GoalBars } from '@/components/charts/goal-bars';
import { ExpenseForm } from '@/components/expense-form';
import { PeriodNav } from '@/components/period-nav';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { ChartInk } from '@/constants/palette';
import { BottomTabInset, EntryPanelWidth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData, useQuery } from '@/data/store';
import { useIsWide } from '@/hooks/use-is-wide';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import {
  addPeriods,
  DefaultPeriodStartDay,
  formatPeriodLabel,
  periodRange,
  today,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { greetingName, timeOfDayGreeting } from '@/lib/name';

export default function HomeScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const theme = useTheme();
  const scheme = useScheme();
  const { budgets, categories, goals, preferences, profile, ready, mutate } = useData();
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  // Any day inside the window being looked at, not the window itself: a start
  // day of the 31st makes periods different lengths, so a day is the only
  // anchor that survives being stepped through them.
  const [anchor, setAnchor] = useState(today());

  // Null for accounts that predate the name being asked for, which is what the
  // greeting line is conditional on — a "Good evening," with nothing after it
  // is worse than no greeting.
  const name = greetingName(profile?.fullName);

  const day = today();
  const startDay = preferences.periodStartDay;
  // The user's pay cycle, not the calendar's. Everything on this screen spans
  // the same window as the budget bars below it, so "left" and "spent" are
  // answers to the same question.
  const { start: periodStart, end: periodEnd } = periodRange(anchor, startDay);
  const calendarMonths = startDay === DefaultPeriodStartDay;

  // Compared on the period's start rather than on a month key: with a custom
  // start day two dates in the same calendar month can belong to different
  // periods. `>=` rather than `===` so a clock that has rolled past the last
  // prefetched period still counts as the present instead of stranding the user
  // one step into a future they can't step back out of.
  const atPresent = periodStart >= periodRange(day, startDay).start;

  const { data: categoryTotals } = useQuery(
    (repo) =>
      repo.categoryTotals({
        from: periodStart,
        to: periodEnd,
        budgetId: selectedBudgetId ?? undefined,
      }),
    [periodStart, periodEnd, selectedBudgetId]
  );

  // Budget cycles are each budget's own — weekly ones tile the window rather
  // than filling it — so progress is asked for on a *day* and answers with the
  // cycle around it. Today while the window holds it, and the window's last day
  // otherwise, which is the cycle a finished period ended on.
  const progressDay = atPresent ? day : periodEnd;
  const { data: progress } = useQuery((repo) => repo.budgetProgress(progressDay), [progressDay]);

  // Goals are cumulative rather than periodic — what the car fund holds is the
  // whole history of what went into it — but still read *as of* the window's
  // day, so stepping back to July shows what it held in July. A card that alone
  // ignored the stepper above it would be the one thing on the screen answering
  // a different question from everything else.
  const { data: goalStatus } = useQuery((repo) => repo.goalProgress(progressDay), [progressDay]);

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

  const currencyCode = preferences.currencyCode;

  // Each block is built once and placed by whichever layout is showing, so the
  // phone column and the wide dashboard can never disagree about what a card
  // says — only about where it sits.
  const greeting = name && (
    <ThemedText type="label" themeColor="textSecondary">
      {timeOfDayGreeting()}, {name}
    </ThemedText>
  );

  const budgetStrip = (
    <BudgetTabStrip
      budgets={budgets}
      selectedId={selectedBudgetId}
      onSelect={setSelectedBudgetId}
      inset={!wide}
    />
  );

  const expenseForm = (
    <ExpenseForm
      budgets={budgets}
      categories={categories}
      activeBudgetId={selectedBudgetId ?? budgets[0]?.id ?? null}
      onSubmit={async (input) => {
        await mutate((repo) => repo.createExpense(input));
        // Step to whatever was just logged if it landed outside the window on
        // screen — a backdated entry otherwise saves to silence, with every
        // chart under it unmoved.
        if (input.spentOn < periodStart || input.spentOn > periodEnd) {
          setAnchor(input.spentOn);
        }
      }}
    />
  );

  // Everything below this answers for the window it names — and the window
  // moves.
  const periodNav = (
    <PeriodNav
      style={wide ? undefined : styles.periodNav}
      align={wide ? 'start' : 'center'}
      label={formatPeriodLabel(periodStart, periodEnd)}
      onPrev={() => setAnchor(addPeriods(anchor, startDay, -1))}
      onNext={atPresent ? undefined : () => setAnchor(addPeriods(anchor, startDay, 1))}
      jump={
        atPresent
          ? undefined
          : {
              label: calendarMonths ? 'This month' : 'Now',
              onPress: () => setAnchor(day),
            }
      }
    />
  );

  /*
    Only when there is something to carry. A "+$0.00 carried over" on a
    first-month account is a line explaining a feature the user hasn't used yet.

    The set-aside line does the same job: "Left" is In minus Out minus *this*,
    and without it the arithmetic doesn't close. A period with no movement to or
    from a goal shows nothing, so an account that has never used the feature
    never sees a line explaining it.
  */
  const flowNotes = (
    <>
      {!!flow?.openingMinor && (
        <CarriedLine
          minor={flow.openingMinor}
          currencyCode={currencyCode}
          periodWord={calendarMonths ? 'months' : 'periods'}
          bare={wide}
        />
      )}
      {!!flow?.savedMinor && (
        <SetAsideLine minor={flow.savedMinor} currencyCode={currencyCode} bare={wide} />
      )}
    </>
  );

  const donutCard = (
    <Card title="Where it went" style={wide ? styles.gridCard : undefined}>
      <DonutChart
        totals={categoryTotals ?? []}
        currencyCode={currencyCode}
        /* Named rather than deictic once the window is historical: "this month"
           under August, read in September, is the chart contradicting the
           stepper directly above it. */
        centerLabel={
          selectedBudgetId
            ? 'this budget'
            : atPresent
              ? calendarMonths
                ? 'this month'
                : 'this period'
              : calendarMonths
                ? formatPeriodLabel(periodStart, periodEnd)
                : 'that period'
        }
      />
    </Card>
  );

  const budgetsCard = (
    <Card title="Budgets" style={wide ? styles.gridCard : undefined}>
      {visibleProgress.length === 0 ? (
        <ThemedText type="label" themeColor="textSecondary">
          No budgets to show.
        </ThemedText>
      ) : (
        <BudgetBars progress={visibleProgress} currencyCode={currencyCode} showTimeLeft={atPresent} />
      )}
    </Card>
  );

  /*
    Hidden entirely on an account with no goals rather than shown empty with an
    invitation. Home's job is to answer "am I okay", and a card advertising an
    unused feature costs that answer a scroll. The Add sheet and Profile are
    where a first goal is found; from then on this card is why the user keeps
    looking.
  */
  const goalsCard = goals.length > 0 && (
    <Card title="Saving for">
      <GoalBars
        progress={goalStatus ?? []}
        currencyCode={currencyCode}
        // The object form rather than a template literal: typed routes
        // type-check the pathname against the file tree, and the goal rides
        // along as a query param on `/contribution/new` so the sheet opens on
        // the pot the user tapped.
        onSelect={(goalId) =>
          router.push({
            pathname: '/contribution/[id]',
            params: { id: 'new', goalId },
          })
        }
      />
    </Card>
  );

  if (wide) {
    return (
      <ThemedView style={styles.wideRoot}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.wideMain}>
          <View style={styles.wideHeader}>
            {greeting}
            {periodNav}
          </View>

          {/*
            "Left" sits on the page rather than in a card: it is the answer the
            whole screen exists to give, and the one place the figure type is
            allowed to be as loud as it gets.
          */}
          <View style={styles.hero}>
            <ThemedText type="label" themeColor="textSecondary">
              Left to spend
            </ThemedText>
            <ThemedText
              type="display"
              style={[
                styles.heroFigure,
                (flow?.availableMinor ?? 0) < 0 && { color: ChartInk[scheme].critical },
              ]}
              tabular>
              {signedMoney(flow?.availableMinor ?? 0, currencyCode)}
            </ThemedText>
            <View style={styles.heroFlow}>
              <HeroStat label="In" minor={flow?.inMinor ?? 0} currencyCode={currencyCode} />
              <HeroStat label="Out" minor={flow?.outMinor ?? 0} currencyCode={currencyCode} />
            </View>
            {flowNotes}
          </View>

          {budgetStrip}

          <View style={styles.grid}>
            {budgetsCard}
            {donutCard}
          </View>
          {goalsCard}
        </ScrollView>

        {/* The till: always open, so logging never costs a click to reach. */}
        <View
          style={[
            styles.entryPanel,
            { backgroundColor: theme.backgroundElement, borderLeftColor: theme.border },
          ]}>
          <ScrollView contentContainerStyle={styles.entryPanelContent} keyboardShouldPersistTaps="handled">
            <ThemedText type="title">What did you spend?</ThemedText>
            {expenseForm}
          </ScrollView>
        </View>
      </ThemedView>
    );
  }

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
              {greeting}
              <ThemedText type="title">What did you spend?</ThemedText>
            </View>

            {budgetStrip}

            <View style={styles.body}>
              <Card>{expenseForm}</Card>

              {periodNav}

              <Card>
                {/*
                  "Left", not "Net": what's on the card is the running balance,
                  so a month where nothing came in still shows the surplus that
                  rolled in from the last one rather than a bare minus figure.
                  It leads on its own line — the same answer the wide hero
                  gives, and three wide figures can't share a phone's width.
                */}
                <FlowStat
                  label="Left to spend"
                  minor={flow?.availableMinor ?? 0}
                  currencyCode={currencyCode}
                  signed
                  lead
                />
                <View style={styles.flowRow}>
                  <FlowStat label="In" minor={flow?.inMinor ?? 0} currencyCode={currencyCode} />
                  <FlowStat label="Out" minor={flow?.outMinor ?? 0} currencyCode={currencyCode} />
                </View>
                {flowNotes}
              </Card>

              {donutCard}
              {budgetsCard}
              {goalsCard}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** A balance with its sign spelled out — "+" is as much the answer as the digits. */
function signedMoney(minor: number, currencyCode: string): string {
  return `${minor > 0 ? '+' : ''}${formatMoney(minor, currencyCode)}`;
}

/** In or Out under the wide hero. Unsigned and uncoloured: both are positive by definition. */
function HeroStat({ label, minor, currencyCode }: { label: string; minor: number; currencyCode: string }) {
  return (
    <View style={styles.heroStat}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="figure" tabular>
        {formatMoney(minor, currencyCode)}
      </ThemedText>
    </View>
  );
}

/**
 * One figure on the flow card. Only "Left" is signed — In and Out are positive
 * by definition, so a sign or colour on them would be decoration.
 */
function FlowStat({
  label,
  minor,
  currencyCode,
  signed = false,
  lead = false,
}: {
  label: string;
  minor: number;
  currencyCode: string;
  signed?: boolean;
  /** The figure the card is about, at the larger size. */
  lead?: boolean;
}) {
  const scheme = useScheme();
  const ink = ChartInk[scheme];
  // Only a deficit is coloured. A surplus is the normal, hoped-for state, and a
  // large green figure reads as a ticker rather than a balance.
  const tone = signed && minor < 0 ? ink.critical : undefined;

  return (
    <View style={styles.flowStat}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText
        type="figure"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[lead ? styles.flowLead : styles.flowFigure, tone ? { color: tone } : undefined]}
        tabular>
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
  bare = false,
}: {
  minor: number;
  currencyCode: string;
  periodWord: string;
  /** Under the wide hero there is no card above to rule off from. */
  bare?: boolean;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const ink = ChartInk[scheme];

  return (
    <View style={bare ? undefined : [styles.carried, { borderTopColor: theme.border }]}>
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

/**
 * What this period put into goals, spelled out under the figures.
 *
 * Worded as "set aside" rather than "saved" throughout. "Saved" is ambiguous in
 * a budgeting app — it also means "didn't spend", which is what `netMinor`
 * measures and a different number entirely.
 *
 * The negative case is not an error state, so it doesn't get the critical ink:
 * taking money back out of a goal is what buying the thing looks like, and the
 * green matches the row it will have produced in Activity.
 */
function SetAsideLine({
  minor,
  currencyCode,
  bare = false,
}: {
  minor: number;
  currencyCode: string;
  bare?: boolean;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const ink = ChartInk[scheme];

  return (
    <View style={bare ? undefined : [styles.carried, { borderTopColor: theme.border }]}>
      <ThemedText type="label" themeColor="textSecondary">
        <ThemedText type="label" style={minor < 0 ? { color: ink.good } : undefined}>
          {formatMoney(Math.abs(minor), currencyCode)}
        </ThemedText>{' '}
        {minor > 0 ? 'set aside for goals' : 'taken back out of goals'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  wideMain: {
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    paddingHorizontal: Spacing.six - Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  wideHeader: {
    gap: Spacing.two,
  },
  hero: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  heroFigure: {
    fontSize: 68,
    lineHeight: 72,
    letterSpacing: -2,
  },
  heroFlow: {
    flexDirection: 'row',
    gap: Spacing.six,
    paddingTop: Spacing.one,
  },
  heroStat: {
    gap: Spacing.half,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  gridCard: {
    flexGrow: 1,
    flexBasis: 320,
  },
  entryPanel: {
    width: EntryPanelWidth,
    flexShrink: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  entryPanelContent: {
    padding: Spacing.four,
    paddingTop: Spacing.five,
    gap: Spacing.four,
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
  periodNav: {
    paddingTop: Spacing.two,
  },
  flowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  flowStat: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  // The figure type at phone size, two to a row.
  flowFigure: {
    fontSize: 18,
    lineHeight: 24,
  },
  flowLead: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
  },
  carried: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
});
