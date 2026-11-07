/**
 * Budget progress — the chart that actually pays the user back for logging.
 *
 * The donut answers "what did I buy"; this answers "am I okay", which is the
 * question that brings people back. Each bar is spend against that budget's
 * limit for its current cycle.
 *
 * Only budgets that *have* a limit get a bar. Uncapped budgets are listed
 * underneath as plain amounts, because plotting them on the same axis would
 * mean two different scales in one chart — the dual-axis mistake wearing a
 * different hat.
 */

import { StyleSheet, View, type DimensionValue } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChartInk, slotColor, withAlpha } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import type { BudgetProgress } from '@/db/types';
import { useScheme } from '@/hooks/use-scheme';
import { formatPeriodLabel } from '@/lib/date';
import { formatMoney, percentOf } from '@/lib/money';

const BAR_HEIGHT = 10;
const END_RADIUS = 4;
/** Track opacity — a lighter step of the bar's own hue, not a neutral gray. */
const TRACK_ALPHA = 0.16;

function BudgetBar({
  entry,
  currencyCode,
  showTimeLeft,
}: {
  entry: BudgetProgress;
  currencyCode: string;
  showTimeLeft: boolean;
}) {
  const scheme = useScheme();
  const ink = ChartInk[scheme];

  const limit = entry.budget.limitMinor!;
  const ratio = percentOf(entry.spentMinor, limit);
  const over = entry.spentMinor > limit;
  const remaining = limit - entry.spentMinor;

  const color = over ? ink.critical : slotColor(entry.budget.colorSlot, scheme);
  // Floor a non-zero spend at 2% so the first small expense is still visible.
  const fillPercent = Math.min(100, Math.max(ratio * 100, entry.spentMinor > 0 ? 2 : 0));
  const fillWidth: DimensionValue = `${fillPercent}%`;

  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <ThemedText type="label" numberOfLines={1} style={styles.name}>
          {entry.budget.name}
        </ThemedText>
        <ThemedText type="label" themeColor="textSecondary" style={styles.amounts}>
          {formatMoney(entry.spentMinor, currencyCode)} / {formatMoney(limit, currencyCode)}
        </ThemedText>
      </View>

      <View
        style={[
          styles.track,
          { backgroundColor: withAlpha(slotColor(entry.budget.colorSlot, scheme), TRACK_ALPHA) },
        ]}>
        <View style={[styles.fill, { width: fillWidth, backgroundColor: color }]} />
      </View>

      <View style={styles.labelRow}>
        <ThemedText type="label" style={[styles.status, over && { color: ink.critical }]}>
          {over
            ? `⚠ Over by ${formatMoney(-remaining, currencyCode)}`
            : `${formatMoney(remaining, currencyCode)} left`}
        </ThemedText>
        <ThemedText type="label" themeColor="textSecondary">
          {showTimeLeft
            ? entry.daysLeft === 0
              ? 'last day'
              : `${entry.daysLeft} ${entry.daysLeft === 1 ? 'day' : 'days'} left`
            : formatPeriodLabel(entry.cycleStart, entry.cycleEnd)}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * A budget with no limit: the running total, and a dot so the pot is still
 * recognisable by its colour. Without the dot these rows are the only place in
 * the app where a budget appears with no colour at all, which makes the card
 * read as two unrelated lists rather than as capped and uncapped halves of one.
 */
function UncappedRow({
  entry,
  currencyCode,
}: {
  entry: BudgetProgress;
  currencyCode: string;
}) {
  const scheme = useScheme();

  return (
    <View style={styles.labelRow}>
      <View style={styles.uncappedName}>
        <View
          style={[styles.dot, { backgroundColor: slotColor(entry.budget.colorSlot, scheme) }]}
        />
        <ThemedText type="label" numberOfLines={1} style={styles.name}>
          {entry.budget.name}
        </ThemedText>
      </View>
      <ThemedText type="label" style={styles.amounts}>
        {formatMoney(entry.spentMinor, currencyCode)}
      </ThemedText>
    </View>
  );
}

export function BudgetBars({
  progress,
  currencyCode,
  showTimeLeft = true,
}: {
  progress: BudgetProgress[];
  currencyCode: string;
  /**
   * Whether the cycles being drawn are the ones running now.
   *
   * Off, each bar names the span it covers instead of counting down to its end.
   * A countdown to a date in the past is simply false, and the span is the fact
   * the user actually needs there: a weekly budget inside a month-long window
   * covers one week of it, and without the dates that bar looks like the whole
   * month's spending come up short.
   */
  showTimeLeft?: boolean;
}) {
  const capped = progress.filter((entry) => entry.budget.limitMinor !== null);
  const uncapped = progress.filter((entry) => entry.budget.limitMinor === null);

  return (
    <View style={styles.container}>
      {capped.map((entry) => (
        <BudgetBar
          key={entry.budget.id}
          entry={entry}
          currencyCode={currencyCode}
          showTimeLeft={showTimeLeft}
        />
      ))}

      {uncapped.length > 0 && (
        <View style={styles.uncapped}>
          {uncapped.map((entry) => (
            <UncappedRow key={entry.budget.id} entry={entry} currencyCode={currencyCode} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  row: {
    gap: Spacing.one,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: {
    flexShrink: 1,
  },
  amounts: {
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: END_RADIUS,
    overflow: 'hidden',
  },
  fill: {
    height: BAR_HEIGHT,
    // Square where it leaves the baseline, rounded at the data end.
    borderTopRightRadius: END_RADIUS,
    borderBottomRightRadius: END_RADIUS,
  },
  status: {
    flexShrink: 1,
  },
  uncapped: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  uncappedName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
