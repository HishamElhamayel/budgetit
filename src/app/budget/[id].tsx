/**
 * Create or edit an envelope. `/budget/new` creates; `/budget/<uuid>` edits.
 *
 * The limit is deliberately optional: forcing a number on a budget the user
 * doesn't actually want to cap is how people end up with limits they ignore,
 * and an ignored limit makes the progress bars lie.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ColorPicker } from '@/components/ui/color-picker';
import { DayOfMonthPicker } from '@/components/ui/day-of-month-picker';
import { nextFreeSlot } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { confirmDestructive } from '@/lib/confirm';
import type { BudgetCycle } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { formatOrdinalDay } from '@/lib/date';
import { minorToInput, parseAmountToMinor } from '@/lib/money';

export default function BudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dismiss = useDismiss();
  const navigation = useNavigation();
  const theme = useTheme();
  const { budgets, mutate, preferences } = useData();

  const isNew = id === 'new';
  const existing = budgets.find((budget) => budget.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [limit, setLimit] = useState(
    existing?.limitMinor != null ? minorToInput(existing.limitMinor, preferences.currencyCode) : ''
  );
  const [cycle, setCycle] = useState<BudgetCycle>(existing?.cycle ?? 'monthly');
  // Null means "follow the app-wide period", which is what a new budget should
  // do — the point of the setting is that most budgets track the salary.
  const [resetDay, setResetDay] = useState<number | null>(existing?.resetDay ?? null);
  const [colorSlot, setColorSlot] = useState(
    existing?.colorSlot ?? nextFreeSlot(budgets.map((budget) => budget.colorSlot))
  );

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New budget' : 'Edit budget' });
  }, [navigation, isNew]);

  const trimmedName = name.trim();
  const canSave =
    trimmedName.length > 0 &&
    (limit.trim() === '' || parseAmountToMinor(limit, preferences.currencyCode) !== null);

  async function save() {
    if (!canSave) return;
    const input = {
      name: trimmedName,
      limitMinor: limit.trim() === '' ? null : parseAmountToMinor(limit, preferences.currencyCode),
      cycle,
      // Cleared on a weekly budget rather than kept: a stored day that nothing
      // reads would come back to life if the user ever flipped the cycle back,
      // silently, months later.
      resetDay: cycle === 'monthly' ? resetDay : null,
      colorSlot,
    };

    await mutate(async (repo) => {
      if (isNew) await repo.createBudget(input);
      else await repo.updateBudget(id, input);
    });
    dismiss();
  }

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      `Delete ${existing?.name}?`,
      'Expenses already logged against it are kept, so your history and past charts stay intact.'
    );
    if (!confirmed) return;

    await mutate((repo) => repo.deleteBudget(id));
    dismiss();
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name">
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Personal"
              placeholderTextColor={theme.textSecondary}
              autoFocus={isNew}
              // Matches `budgets_name_length` in the input_bounds migration.
              // The column is the real limit; this is what stops anyone meeting
              // it by accident and getting an error instead of a full stop.
              maxLength={80}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Budget name"
            />
          </View>
        </Field>

        <Field label={`Limit (optional, ${preferences.currencyCode})`}>
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={limit}
              onChangeText={setLimit}
              placeholder="No limit"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              inputMode="decimal"
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Budget limit"
            />
          </View>
        </Field>

        <Field label="Spending resets">
          <View style={styles.row}>
            {(['weekly', 'monthly'] as const).map((option) => (
              <Chip
                key={option}
                label={option === 'weekly' ? 'Every week' : 'Every month'}
                selected={cycle === option}
                onPress={() => setCycle(option)}
              />
            ))}
          </View>
        </Field>

        {/* Only for monthly budgets. A week has no day-of-month to restart on,
            and showing a disabled grid would be a control that never works.

            Labelled "Each month starts on" rather than anything with "reset"
            in it: sitting directly under "Resets", a second reset-shaped label
            reads as a rival setting rather than as the day the one above it
            happens on. */}
        {cycle === 'monthly' && (
          <Field label="Each month starts on">
            <DayOfMonthPicker
              selected={resetDay}
              onSelect={setResetDay}
              followLabel={`Same as app (${formatOrdinalDay(preferences.periodStartDay)})`}
            />
          </Field>
        )}

        <Field label="Colour">
          <ColorPicker selected={colorSlot} onSelect={setColorSlot} />
        </Field>

        <Button label={isNew ? 'Create budget' : 'Save changes'} onPress={save} disabled={!canSave} />

        {!isNew && existing && (
          <Button label="Delete budget" onPress={confirmDelete} variant="danger" />
        )}
      </ScrollView>
    </ThemedView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
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
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  inputWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 14,
  },
});
