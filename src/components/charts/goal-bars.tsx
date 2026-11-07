/**
 * Goal progress — the mirror of the budget bars, and deliberately the opposite
 * colour story.
 *
 * On a budget bar, a full track is bad: the fill turns critical red the moment
 * spending crosses the limit. On a goal, a full track is the entire point, so
 * reaching the target turns the bar `good` green and the status line says so.
 * Same geometry, inverted meaning — which is exactly why the two charts have to
 * *look* alike. A user reading them one above the other learns one shape and
 * applies it twice; the colour is what tells them which way round it is.
 *
 * Goals lead with their icon where budgets lead with nothing. A budget is a
 * category of intent the user invented; a goal is a thing they want, and the
 * disc is what makes a list of four of them scannable without reading.
 *
 * Goals with no target are listed underneath as plain amounts, for the reason
 * the budget bars do the same with uncapped budgets: there is no axis to plot
 * them against, and inventing one would be two scales in one chart.
 *
 * Every row is a button, where a budget bar is not. A budget's bar is filled by
 * logging expenses, which the form at the top of Home already does; a goal's is
 * filled only by an explicit decision to move money, and the row showing how far
 * along it is happens to be exactly where the user is standing when they make
 * that decision.
 */

import { Pressable, StyleSheet, View, type DimensionValue } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlyphDisc } from '@/components/ui/glyph';
import { ChartInk, slotColor, withAlpha } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import type { GoalProgress } from '@/db/types';
import { useScheme } from '@/hooks/use-scheme';
import { formatDayLabel } from '@/lib/date';
import { formatMoney, percentOf } from '@/lib/money';

const BAR_HEIGHT = 10;
const END_RADIUS = 4;
/** Track opacity — a lighter step of the bar's own hue, not a neutral grey. */
const TRACK_ALPHA = 0.16;

/**
 * What the deadline line says, or null when the goal has no date.
 *
 * Three states rather than a countdown, because a countdown alone answers the
 * wrong question once the day has passed. A goal that is already funded has
 * nothing to be late for, so its date drops out entirely rather than reporting
 * that the user missed a deadline they in fact met.
 */
function deadlineLabel(entry: GoalProgress, done: boolean): string | null {
  if (entry.goal.targetDay === null || done) return null;
  if (entry.daysLeft === null) return null;

  if (entry.daysLeft < 0) return `${formatDayLabel(entry.goal.targetDay)} — overdue`;
  if (entry.daysLeft === 0) return 'due today';
  return `${entry.daysLeft} ${entry.daysLeft === 1 ? 'day' : 'days'} left`;
}

/**
 * Wraps a row so it opens the money-moving sheet, or leaves it inert when no
 * handler was given. Both paths render the same tree, so a row does not shift
 * by a pixel depending on whether it is interactive.
 */
function GoalRow({
  goalId,
  name,
  onSelect,
  children,
}: {
  goalId: string;
  name: string;
  onSelect?: (goalId: string) => void;
  children: React.ReactNode;
}) {
  if (!onSelect) return <>{children}</>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Move money for ${name}`}
      onPress={() => onSelect(goalId)}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
      {children}
    </Pressable>
  );
}

function GoalBar({ entry, currencyCode }: { entry: GoalProgress; currencyCode: string }) {
  const scheme = useScheme();
  const ink = ChartInk[scheme];

  const target = entry.goal.targetMinor!;
  const done = entry.savedMinor >= target;
  const slot = slotColor(entry.goal.colorSlot, scheme);
  const color = done ? ink.good : slot;

  const ratio = percentOf(entry.savedMinor, target);
  // Floor a non-zero balance at 2% so the first contribution is still visible,
  // matching the budget bars so the two read at the same scale.
  const fillPercent = Math.min(100, Math.max(ratio * 100, entry.savedMinor > 0 ? 2 : 0));
  const fillWidth: DimensionValue = `${fillPercent}%`;

  const deadline = deadlineLabel(entry, done);
  const overdue = !done && entry.daysLeft !== null && entry.daysLeft < 0;

  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <View style={styles.nameRow}>
          {/* Tinted with the goal's own slot even when the bar has gone green.
              The disc is identity and the bar is status, and letting the two
              move together would make a finished goal unrecognisable as the one
              the user has been watching. */}
          <GlyphDisc icon={entry.goal.icon} color={slot} size={28} />
          <ThemedText type="label" numberOfLines={1} style={styles.name}>
            {entry.goal.name}
          </ThemedText>
        </View>
        <ThemedText type="label" themeColor="textSecondary" style={styles.amounts}>
          {formatMoney(entry.savedMinor, currencyCode)} / {formatMoney(target, currencyCode)}
        </ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: withAlpha(slot, TRACK_ALPHA) }]}>
        <View style={[styles.fill, { width: fillWidth, backgroundColor: color }]} />
      </View>

      <View style={styles.labelRow}>
        <ThemedText type="label" style={[styles.status, done && { color: ink.good }]}>
          {done
            ? '✓ Fully saved'
            : `${formatMoney(entry.remainingMinor ?? 0, currencyCode)} to go`}
        </ThemedText>
        {deadline && (
          <ThemedText
            type="label"
            themeColor={overdue ? undefined : 'textSecondary'}
            style={overdue ? { color: ink.critical } : undefined}>
            {deadline}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

/**
 * A goal with no target: what it holds, and the icon so the pot stays
 * recognisable. The counterpart of `UncappedRow` in the budget bars, and here
 * for the same reason — without it the card reads as two unrelated lists rather
 * than as the targeted and untargeted halves of one.
 */
function UntargetedRow({ entry, currencyCode }: { entry: GoalProgress; currencyCode: string }) {
  const scheme = useScheme();

  return (
    <View style={styles.labelRow}>
      <View style={styles.nameRow}>
        <GlyphDisc
          icon={entry.goal.icon}
          color={slotColor(entry.goal.colorSlot, scheme)}
          size={28}
        />
        <ThemedText type="label" numberOfLines={1} style={styles.name}>
          {entry.goal.name}
        </ThemedText>
      </View>
      <ThemedText type="label" style={styles.amounts}>
        {formatMoney(entry.savedMinor, currencyCode)}
      </ThemedText>
    </View>
  );
}

export function GoalBars({
  progress,
  currencyCode,
  onSelect,
}: {
  progress: GoalProgress[];
  currencyCode: string;
  /** Tapping a goal. Omit to render the card as a read-only summary. */
  onSelect?: (goalId: string) => void;
}) {
  const targeted = progress.filter((entry) => entry.goal.targetMinor !== null);
  const untargeted = progress.filter((entry) => entry.goal.targetMinor === null);

  return (
    <View style={styles.container}>
      {targeted.map((entry) => (
        <GoalRow
          key={entry.goal.id}
          goalId={entry.goal.id}
          name={entry.goal.name}
          onSelect={onSelect}>
          <GoalBar entry={entry} currencyCode={currencyCode} />
        </GoalRow>
      ))}

      {untargeted.length > 0 && (
        <View style={styles.untargeted}>
          {untargeted.map((entry) => (
            <GoalRow
              key={entry.goal.id}
              goalId={entry.goal.id}
              name={entry.goal.name}
              onSelect={onSelect}>
              <UntargetedRow entry={entry} currencyCode={currencyCode} />
            </GoalRow>
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
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
  untargeted: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
