/**
 * The strip across the top of Home.
 *
 * It does double duty on purpose: the selected budget is both the default for
 * the form below *and* the filter for the charts. That is what earns it the
 * space — a row that only filtered would be a lot of screen for one job.
 *
 * The active item is marked with an accent underline rather than a filled
 * pill. Underneath sits the amount hero, and a filled pill up here would
 * compete with it for the eye; a 2px rule states the selection and then gets
 * out of the way.
 *
 * "All" leads because it's the honest default before the user has a reason to
 * narrow, and it's the only view where the donut shows total spending.
 */

import { ScrollView, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Budget } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';

export const ALL_BUDGETS = null;

export function BudgetTabStrip({
  budgets,
  selectedId,
  onSelect,
}: {
  budgets: Budget[];
  selectedId: string | null;
  onSelect: (budgetId: string | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.container}>
      <Tab label="All" selected={selectedId === ALL_BUDGETS} onPress={() => onSelect(ALL_BUDGETS)} />

      {budgets.map((budget) => (
        <Tab
          key={budget.id}
          label={budget.name}
          selected={selectedId === budget.id}
          onPress={() => onSelect(budget.id)}
        />
      ))}
    </ScrollView>
  );
}

function Tab({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <ThemedText type="body" themeColor={selected ? 'text' : 'textMuted'}>
        {label}
      </ThemedText>
      <View
        style={[styles.rule, { backgroundColor: selected ? theme.accent : 'transparent' }]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    alignItems: 'flex-end',
  },
  tab: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  rule: {
    height: 2,
    borderRadius: 1,
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.6,
  },
});
