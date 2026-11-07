/**
 * Record or edit income. `/income/new` creates; `/income/<uuid>` edits.
 *
 * The budget field is optional by design (see db/types.ts): tagging a paycheck
 * to a pot answers "which one did this fill", but income that isn't earmarked
 * shouldn't be forced into a bucket just to be recorded.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import DateTimePicker from '@/components/ui/date-time-picker';
import { slotColor } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData, useQuery } from '@/data/store';
import type { IncomeDetail } from '@/db/types';
import { useDismiss } from '@/hooks/use-dismiss';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { addDays, formatDayLabel, fromDayKey, toDayKey, today } from '@/lib/date';
import { minorToInput, parseAmountToMinor } from '@/lib/money';

export default function IncomeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const isNew = id === 'new';

  const { data: existing, loading } = useQuery(
    (repo) => (isNew ? Promise.resolve(null) : repo.getIncome(id)),
    [id, isNew]
  );

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New income' : 'Edit income' });
  }, [navigation, isNew]);

  // Hold the form back until the record exists, so the fields below can seed
  // their state directly from it. Rendering first and back-filling with an
  // effect would let a refetch overwrite what the user is typing.
  if (!isNew && loading) {
    return <ThemedView style={styles.root} />;
  }

  if (!isNew && !existing) {
    return (
      <ThemedView style={styles.root}>
        <ThemedText style={styles.missing}>This income no longer exists.</ThemedText>
      </ThemedView>
    );
  }

  return <IncomeForm id={id} isNew={isNew} existing={existing ?? null} />;
}

function IncomeForm({
  id,
  isNew,
  existing,
}: {
  id: string;
  isNew: boolean;
  existing: IncomeDetail | null;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const dismiss = useDismiss();
  const { budgets, preferences, mutate } = useData();

  const [amount, setAmount] = useState(
    existing ? minorToInput(existing.amountMinor, preferences.currencyCode) : ''
  );
  const [source, setSource] = useState(existing?.source ?? '');
  const [budgetId, setBudgetId] = useState<string | null>(existing?.budgetId ?? null);
  const [receivedOn, setReceivedOn] = useState(existing?.receivedOn ?? today());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const amountMinor = parseAmountToMinor(amount, preferences.currencyCode);
  const canSave = amountMinor !== null;
  const dateChips = [today(), addDays(today(), -1)];

  async function save() {
    if (amountMinor === null) return;
    const input = { budgetId, amountMinor, source: source.trim() || null, receivedOn };

    await mutate(async (repo) => {
      if (isNew) await repo.createIncome(input);
      else await repo.updateIncome(id, input);
    });
    dismiss();
  }

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      'Delete this income?',
      'It will no longer count towards your totals.'
    );
    if (!confirmed) return;

    await mutate((repo) => repo.deleteIncome(id));
    dismiss();
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label={`Amount (${preferences.currencyCode})`}>
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              inputMode="decimal"
              autoFocus={isNew}
              style={[styles.input, styles.amountInput, { color: theme.text }]}
              accessibilityLabel="Income amount"
            />
          </View>
        </Field>

        <Field label="Source">
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={source}
              onChangeText={setSource}
              placeholder="Salary, refund, side project…"
              placeholderTextColor={theme.textSecondary}
              // Matches `incomes_source_length` in the input_bounds migration.
              maxLength={200}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Income source"
            />
          </View>
        </Field>

        <Field label="Goes into (optional)">
          <View style={styles.row}>
            <Chip
              label="Not assigned"
              selected={budgetId === null}
              onPress={() => setBudgetId(null)}
            />
            {budgets.map((budget) => (
              <Chip
                key={budget.id}
                label={budget.name}
                color={slotColor(budget.colorSlot, scheme)}
                selected={budgetId === budget.id}
                onPress={() => setBudgetId(budget.id)}
              />
            ))}
          </View>
        </Field>

        <Field label="Received">
          <View style={styles.row}>
            {dateChips.map((day) => (
              <Chip
                key={day}
                label={formatDayLabel(day)}
                selected={receivedOn === day}
                onPress={() => setReceivedOn(day)}
              />
            ))}
            {/* iOS and web have no dialog to dismiss: the compact picker is a field
                that opens and closes its own overlay, so it sits in the row
                where the "pick a date" chip would be. Android's picker *is* a
                dialog, so there the chip stays and opens it. */}
            {Platform.OS !== 'android' ? (
              <DateTimePicker
                value={fromDayKey(receivedOn)}
                mode="date"
                display="compact"
                themeVariant={scheme}
                accentColor={theme.accent}
                style={styles.datePicker}
                onValueChange={(_, date) => {
                  if (date) setReceivedOn(toDayKey(date));
                }}
              />
            ) : (
              <Chip
                label={
                  dateChips.includes(receivedOn) ? 'Pick a date' : formatDayLabel(receivedOn)
                }
                selected={!dateChips.includes(receivedOn)}
                onPress={() => setShowDatePicker(true)}
              />
            )}
          </View>
        </Field>

        {showDatePicker && (
          <DateTimePicker
            value={fromDayKey(receivedOn)}
            mode="date"
            display="default"
            onValueChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setReceivedOn(toDayKey(date));
            }}
            onDismiss={() => setShowDatePicker(false)}
          />
        )}

        <Button label={isNew ? 'Add income' : 'Save changes'} onPress={save} disabled={!canSave} />

        {!isNew && (
          <Button label="Delete income" onPress={confirmDelete} variant="danger" />
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
    alignItems: 'center',
    gap: Spacing.two,
  },
  datePicker: {
    // The native compact picker sizes itself; without this it stretches to
    // fill the row and pushes the quick chips out of alignment.
    flexShrink: 0,
    marginLeft: 'auto',
  },
  inputWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 14,
  },
  amountInput: {
    fontSize: 24,
    // Must override the shared 20px line height — a 24px glyph in a 20px line
    // box gets its descenders clipped.
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  missing: {
    padding: Spacing.four,
  },
  pressed: {
    opacity: 0.6,
  },
});
