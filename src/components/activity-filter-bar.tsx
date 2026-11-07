/**
 * The ledger's narrowing row: every budget, every goal and every category, one
 * tap each.
 *
 * All three kinds share a single scrolling row rather than getting a labelled
 * row apiece. Activity already spends three rows on chrome before a single
 * entry is drawn, and a fourth was affordable where a sixth would not be — but
 * the deciding argument is that they are alternatives, not axes. Only one
 * filter is ever active, so putting them side by side makes the choice look
 * like what it is: pick the one thing you want to see.
 *
 * They stay distinguishable without headings because {@link Chip} already marks
 * them differently — a category and a goal carry their icon, a budget a plain
 * dot — and a rule separates each group. That mark is silent to a screen
 * reader, which is why each chip states its kind in `accessibilityLabel`
 * instead; it is also why goals sit between budgets and categories rather than
 * after them, so the two icon-bearing groups are never adjacent with only a
 * hairline to tell them apart.
 *
 * Tapping the active chip clears it, so "show me everything again" doesn't
 * require scrolling back to "All" after a long row.
 */

import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { slotColor } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import type { Budget, Category, Goal } from '@/db/types';
import type { ActivityFilter } from '@/hooks/use-activity-window';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

export function ActivityFilterBar({
  budgets,
  goals,
  categories,
  filter,
  onChange,
}: {
  budgets: Budget[];
  goals: Goal[];
  categories: Category[];
  filter: ActivityFilter | null;
  onChange: (filter: ActivityFilter | null) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();

  // A brand-new account has none of them, and a row holding a lone "All" chip
  // is a control that can only do nothing.
  if (budgets.length === 0 && goals.length === 0 && categories.length === 0) return null;

  function toggle(next: ActivityFilter) {
    const active = filter?.kind === next.kind && filter.id === next.id;
    onChange(active ? null : next);
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Without this the first tap after typing only dismisses the keyboard,
      // and the chip the finger actually landed on is never pressed.
      keyboardShouldPersistTaps="handled"
      style={styles.row}
      contentContainerStyle={styles.content}>
      <Chip label="All" selected={filter === null} onPress={() => onChange(null)} />

      {budgets.map((budget) => (
        <Chip
          key={budget.id}
          label={budget.name}
          color={slotColor(budget.colorSlot, scheme)}
          selected={filter?.kind === 'budget' && filter.id === budget.id}
          accessibilityLabel={`Budget: ${budget.name}`}
          onPress={() => toggle({ kind: 'budget', id: budget.id })}
        />
      ))}

      {budgets.length > 0 && goals.length > 0 && (
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
      )}

      {goals.map((goal) => (
        <Chip
          key={goal.id}
          label={goal.name}
          color={slotColor(goal.colorSlot, scheme)}
          icon={goal.icon}
          selected={filter?.kind === 'goal' && filter.id === goal.id}
          accessibilityLabel={`Goal: ${goal.name}`}
          onPress={() => toggle({ kind: 'goal', id: goal.id })}
        />
      ))}

      {(budgets.length > 0 || goals.length > 0) && categories.length > 0 && (
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
      )}

      {categories.map((category) => (
        <Chip
          key={category.id}
          label={category.name}
          color={slotColor(category.colorSlot, scheme)}
          icon={category.icon}
          selected={filter?.kind === 'category' && filter.id === category.id}
          accessibilityLabel={`Category: ${category.name}`}
          onPress={() => toggle({ kind: 'category', id: category.id })}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Escapes the header's padding so the row scrolls edge to edge — a chip
  // clipped by an inset reads as the end of the list rather than as more of it.
  row: {
    marginHorizontal: -Spacing.three,
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: Spacing.one,
    marginHorizontal: Spacing.one,
  },
});
