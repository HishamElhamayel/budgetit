/**
 * Edit or delete a single expense.
 *
 * Non-negotiable for a tracker: a mistyped amount the user can't fix is the
 * fastest way to lose them. Reached by tapping any row in the Expenses list.
 */

import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { ExpenseForm } from '@/components/expense-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useData, useQuery } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { confirmDestructive } from '@/lib/confirm';
import { minorToInput } from '@/lib/money';

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dismiss = useDismiss();
  const { budgets, categories, preferences, mutate } = useData();

  const { data: expense, loading } = useQuery((repo) => repo.getExpense(id), [id]);

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      'Delete this expense?',
      'This removes it from your charts and totals.'
    );
    if (!confirmed) return;

    await mutate((repo) => repo.deleteExpense(id));
    dismiss();
  }

  if (loading) {
    return <ThemedView style={styles.root} />;
  }

  if (!expense) {
    return (
      <ThemedView style={styles.root}>
        <ThemedText style={styles.missing}>This expense no longer exists.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ExpenseForm
          budgets={budgets}
          categories={categories}
          activeBudgetId={expense.budgetId}
          submitLabel="Save changes"
          initial={{
            amount: minorToInput(expense.amountMinor, preferences.currencyCode),
            description: expense.description ?? '',
            budgetId: expense.budgetId,
            categoryId: expense.categoryId,
            spentOn: expense.spentOn,
          }}
          onSubmit={async (input) => {
            await mutate((repo) => repo.updateExpense(id, input));
            dismiss();
          }}
        />

        <Button label="Delete expense" onPress={confirmDelete} variant="danger" />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  missing: {
    padding: Spacing.four,
  },
  pressed: {
    opacity: 0.6,
  },
});
