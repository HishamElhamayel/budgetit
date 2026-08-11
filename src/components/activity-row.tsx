import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ThemedText } from '@/components/themed-text';
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
 * One line in the ledger, either kind, swipe-left to delete.
 *
 * The leading dot carries the *budget* colour for an expense and the good-news
 * ink for income, so which direction the money went is legible before any text
 * is read. Amounts are signed for the same reason: in a list that mixes both, an
 * unsigned figure is ambiguous in a way it never was on an expenses-only screen.
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

  const title = isExpense
    ? entry.description?.trim() || entry.categoryName || 'Expense'
    : entry.source?.trim() || 'Income';

  const subtitle = isExpense
    ? [entry.budgetName, entry.categoryName].filter(Boolean).join(' · ')
    : entry.budgetName ?? 'Not assigned';

  const dotColor = isExpense
    ? slotColor(entry.budgetColorSlot, scheme)
    : ChartInk[scheme].good;

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      isExpense ? 'Delete this expense?' : 'Delete this income?',
      'It will no longer count towards your totals.'
    );

    if (!confirmed) {
      swipeable.current?.close();
      return;
    }

    // Deliberately not closed first: the row is about to stop existing, and
    // closing it would animate it back into place a frame before the refetch
    // takes it away.
    await mutate((repo) =>
      entry.kind === 'expense' ? repo.deleteExpense(entry.id) : repo.deleteIncome(entry.id)
    );
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
          accessibilityLabel={isExpense ? 'Delete expense' : 'Delete income'}
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
          router.push(isExpense ? `/expense/${entry.id}` : `/income/${entry.id}`)
        }
        // Fully opaque, always. The delete panel is parked behind this row
        // rather than sliding in, so it is this background that hides it — and
        // the red only appears to grow because the row slides off it.
        style={[styles.row, { backgroundColor: theme.background }]}>
        {/* Press feedback dims the *contents*, never the row itself. Putting
            the usual `pressed && { opacity }` on the Pressable above made the
            whole row translucent the instant a finger landed, which showed the
            full-width red panel through it for the split second before the pan
            took over — the box looked like it flashed on rather than being
            dragged out. */}
        {({ pressed }) => (
          <View style={[styles.rowContent, pressed && styles.pressed]}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />

            <View style={styles.text}>
              <ThemedText numberOfLines={1}>{title}</ThemedText>
              <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
                {subtitle}
              </ThemedText>
            </View>

            <ThemedText
              type="label"
              style={[styles.amount, !isExpense && { color: ChartInk[scheme].good }]}>
              {isExpense ? '−' : '+'}
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
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
