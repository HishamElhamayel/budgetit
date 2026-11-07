import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ThemedText } from '@/components/themed-text';
import { GlyphDisc } from '@/components/ui/glyph';
import { SystemSymbols } from '@/constants/icons';
import { ChartInk, slotColor } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import type { ActivityEntry } from '@/db/types';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { formatMoney } from '@/lib/money';

/**
 * Width of the delete panel behind a swiped row, and so the distance the row
 * travels when fully open.
 *
 * The panel is glued to the row's right edge rather than fading in, so the red
 * grows out of the screen edge as the finger moves and the row occludes
 * whatever hasn't been uncovered yet. That is what makes the block feel dragged
 * out rather than switched on.
 */
const ActionWidth = 96;

/**
 * One line in the ledger, any of the three kinds, swipe-left to delete.
 *
 * The leading disc carries the *category* — its icon on a wash of its colour —
 * which is the same identity the donut on Home draws, so a slice and the rows
 * that make it up are recognisably the same thing. It used to be a bare dot in
 * the budget's colour; the budget is still named in the subtitle, and the thing
 * a dot could say that the icon can't (which pot paid) was the one fact the
 * line underneath already stated.
 *
 * Income gets the good-news ink and an arrow instead, so which direction the
 * money went is legible before any text is read. Amounts are signed for the
 * same reason: in a list that mixes both, an unsigned figure is ambiguous in a
 * way it never was on an expenses-only screen.
 *
 * A goal contribution wears the goal's own icon and colour, and is signed by
 * its effect on the *spendable* balance — money set aside reads `−` exactly as
 * an expense does, because that is what it did to the figure on Home. What
 * keeps it from being mistaken for spending is the disc and the goal named
 * underneath, not the sign: the sign is arithmetic, and softening it would make
 * the ledger stop adding up.
 */
export function ActivityRow({
  entry,
  currencyCode,
}: {
  entry: ActivityEntry;
  currencyCode: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const router = useRouter();
  const { mutate } = useData();

  // Held so a cancelled confirm can spring the row shut. Without it the delete
  // panel stays open behind a row the user just decided to keep.
  const swipeable = useRef<SwipeableMethods>(null);

  const isExpense = entry.kind === 'expense';
  const isContribution = entry.kind === 'contribution';
  // Money leaving the spendable pool: an expense, or a movement *into* a goal.
  // The one question the sign and the ink both answer.
  const outward = isExpense || (isContribution && entry.direction === 'in');

  const title =
    entry.kind === 'expense'
      ? entry.description?.trim() || entry.categoryName || 'Expense'
      : entry.kind === 'income'
        ? entry.source?.trim() || 'Income'
        : entry.note?.trim() || (entry.direction === 'in' ? 'Set aside' : 'Taken back out');

  const subtitle =
    entry.kind === 'expense'
      ? [entry.budgetName, entry.categoryName].filter(Boolean).join(' · ')
      : entry.kind === 'income'
        ? entry.budgetName ?? 'Not assigned'
        : entry.goalName;

  // Uncategorised expenses fall back to the budget's colour rather than to the
  // muted ink the donut uses for them: in a list, a grey row reads as disabled.
  const markColor =
    entry.kind === 'expense'
      ? slotColor(entry.categoryColorSlot ?? entry.budgetColorSlot, scheme)
      : entry.kind === 'income'
        ? ChartInk[scheme].good
        : slotColor(entry.goalColorSlot, scheme);

  const kindLabel = isExpense ? 'expense' : isContribution ? 'movement' : 'income';

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      `Delete this ${kindLabel}?`,
      isContribution
        ? 'The money goes back to wherever it came from.'
        : 'It will no longer count towards your totals.'
    );

    if (!confirmed) {
      swipeable.current?.close();
      return;
    }

    // Deliberately not closed first: the row is about to stop existing, and
    // closing it would animate it back into place a frame before the refetch
    // takes it away.
    await mutate((repo) => {
      if (entry.kind === 'expense') return repo.deleteExpense(entry.id);
      if (entry.kind === 'income') return repo.deleteIncome(entry.id);
      return repo.deleteContribution(entry.id);
    });
  }

  return (
    <Swipeable
      ref={swipeable}
      friction={2}
      rightThreshold={ActionWidth / 2}
      // Without this the row rubber-bands past the action panel, which on a
      // full-width delete reads as though the swipe itself deleted something.
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${kindLabel}`}
          onPress={() => void confirmDelete()}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: ChartInk[scheme].critical },
            pressed && styles.pressed,
          ]}>
          {/* White rather than themed ink: this text sits on the critical red
              in both schemes, which is the one surface in the app that isn't a
              theme background. */}
          <ThemedText type="label" style={styles.actionLabel}>
            Delete
          </ThemedText>
        </Pressable>
      )}>
      {/* Navigates imperatively rather than through `<Link asChild>`, for the
          reason spelled out in components/app-tabs.tsx: `asChild` merges props
          with Radix's Slot, and its rule for `style` is a plain object spread.
          A function style — the only form that can react to `pressed` — spreads
          to nothing, so every rule below was silently dropped. That cost this
          row its `flexDirection`, its padding *and* its background: the fields
          stacked at the screen edge, and with nothing opaque left to slide over
          the delete panel, the red block showed through from the first pixel of
          the drag instead of being uncovered by it. */}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          router.push(
            entry.kind === 'expense'
              ? `/expense/${entry.id}`
              : entry.kind === 'income'
                ? `/income/${entry.id}`
                : `/contribution/${entry.id}`
          )
        }
        // Fully opaque, always — hovered included, which is why hover swaps in
        // another solid colour rather than a tint. The delete panel is parked
        // behind this row rather than sliding in, so it is this background that
        // hides it — and the red only appears to grow because the row slides
        // off it.
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.row,
          { backgroundColor: hovered ? theme.backgroundSelected : theme.background },
        ]}>
        {/* Press feedback dims the *contents*, never the row itself. Putting
            the usual `pressed && { opacity }` on the Pressable above made the
            whole row translucent the instant a finger landed, which showed the
            full-width red panel through it for the split second before the pan
            took over — the box looked like it flashed on rather than being
            dragged out. */}
        {({ pressed }) => (
          <View style={[styles.rowContent, pressed && styles.pressed]}>
            <GlyphDisc
              icon={
                entry.kind === 'expense'
                  ? entry.categoryIcon
                  : entry.kind === 'contribution'
                    ? entry.goalIcon
                    : undefined
              }
              // Only income borrows an app-owned glyph. Expenses and
              // contributions both have one of the user's own to draw.
              symbol={entry.kind === 'income' ? SystemSymbols.income : undefined}
              color={markColor}
            />

            <View style={styles.text}>
              <ThemedText numberOfLines={1}>{title}</ThemedText>
              <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
                {subtitle}
              </ThemedText>
            </View>

            {/* Green is reserved for money arriving in the spendable pool,
                whichever direction it came from — a paycheck or a goal being
                emptied. Money leaving it stays in plain ink, so the colour
                means one thing across all three kinds. */}
            <ThemedText
              type="label"
              style={[styles.amount, !outward && { color: ChartInk[scheme].good }]}>
              {outward ? '−' : '+'}
              {formatMoney(entry.amountMinor, currencyCode)}
            </ThemedText>
          </View>
        )}
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: Spacing.two,
    // The row carries its own horizontal inset instead of inheriting one from
    // the list, so the red block behind it can run all the way to the screen
    // edge. A padded list would leave a strip of ground to the right of it.
    paddingHorizontal: Spacing.three,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  action: {
    width: ActionWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#FFFFFF',
  },
  text: {
    flex: 1,
  },
  amount: {
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.6,
  },
});
