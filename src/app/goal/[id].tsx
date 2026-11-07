/**
 * Create or edit a savings goal. `/goal/new` creates; `/goal/<uuid>` edits.
 *
 * Both the target amount and the target date are optional, and for the same
 * reason a budget's limit is: a number invented to get past a required field is
 * a number the progress bar then reports against. "Some money set aside for
 * emergencies" is a real goal with no finish line, and forcing one on it would
 * make the app wrong about the only goal the user was honest about.
 *
 * Moving money is deliberately *not* here. This screen is where a goal is
 * defined, which happens once; putting money in happens every payday and lives
 * on `/contribution/new` — reached by tapping the goal on Home, where the user
 * already is.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ColorPicker } from '@/components/ui/color-picker';
import DateTimePicker from '@/components/ui/date-time-picker';
import { GlyphDisc } from '@/components/ui/glyph';
import { IconPicker } from '@/components/ui/icon-picker';
import { DefaultGoalIcon } from '@/constants/icons';
import { nextFreeSlot, slotColor } from '@/constants/palette';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { addDays, formatDayLabel, fromDayKey, toDayKey, today } from '@/lib/date';
import { minorToInput, parseAmountToMinor } from '@/lib/money';

export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dismiss = useDismiss();
  const navigation = useNavigation();
  const theme = useTheme();
  const scheme = useScheme();
  const { goals, budgets, categories, preferences, mutate } = useData();

  const isNew = id === 'new';
  const existing = goals.find((goal) => goal.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [target, setTarget] = useState(
    existing?.targetMinor != null ? minorToInput(existing.targetMinor, preferences.currencyCode) : ''
  );
  const [targetDay, setTargetDay] = useState<string | null>(existing?.targetDay ?? null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [icon, setIcon] = useState(existing?.icon ?? DefaultGoalIcon);
  // Seeded against every coloured thing in the account, not just the goals.
  // Budgets, categories and goals all draw from one ten-slot palette and all
  // three appear on Home, so picking "the first slot no *goal* uses" would hand
  // a new goal the colour of the budget directly above it.
  const [colorSlot, setColorSlot] = useState(
    existing?.colorSlot ??
      nextFreeSlot([
        ...goals.map((goal) => goal.colorSlot),
        ...budgets.map((budget) => budget.colorSlot),
        ...categories.map((category) => category.colorSlot),
      ])
  );

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New goal' : 'Edit goal' });
  }, [navigation, isNew]);

  const trimmedName = name.trim();
  const canSave =
    trimmedName.length > 0 &&
    (target.trim() === '' || parseAmountToMinor(target, preferences.currencyCode) !== null);

  async function save() {
    if (!canSave) return;
    const input = {
      name: trimmedName,
      targetMinor:
        target.trim() === '' ? null : parseAmountToMinor(target, preferences.currencyCode),
      targetDay,
      icon,
      colorSlot,
    };

    await mutate(async (repo) => {
      if (isNew) await repo.createGoal(input);
      else await repo.updateGoal(id, input);
    });
    dismiss();
  }

  async function confirmDelete() {
    // Spelled out rather than softened. This is the one delete in the app that
    // gives something back, and a user who expects the budget behaviour —
    // history kept, money still gone — would otherwise find their balance
    // jumped by a few thousand with no explanation on screen.
    const confirmed = await confirmDestructive(
      `Delete ${existing?.name}?`,
      'The money you set aside for it goes back into your available balance.'
    );
    if (!confirmed) return;

    await mutate((repo) => repo.deleteGoal(id));
    dismiss();
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* The row this goal will become, drawn from the live form values —
            the same preview the category screen opens with, and here for the
            same reason: icon and colour are choices with no visible
            consequence until they land somewhere. */}
        <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
          <GlyphDisc icon={icon} color={slotColor(colorSlot, scheme)} size={44} />
          <ThemedText type="heading" numberOfLines={1} style={styles.previewName}>
            {trimmedName || 'New goal'}
          </ThemedText>
        </View>

        <Field label="Saving up for">
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="A car"
              placeholderTextColor={theme.textSecondary}
              autoFocus={isNew}
              // Matches `goals_name_length` in the savings_goals migration. The
              // column is the real limit; this is what stops anyone meeting it
              // by accident and getting an error instead of a full stop.
              maxLength={80}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Goal name"
            />
          </View>
        </Field>

        <Field label={`Target (optional, ${preferences.currencyCode})`}>
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={target}
              onChangeText={setTarget}
              placeholder="No target"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              inputMode="decimal"
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Goal target"
            />
          </View>
          <ThemedText type="label" themeColor="textSecondary">
            Leave it empty to just watch the pot grow.
          </ThemedText>
        </Field>

        <Field label="By when (optional)">
          <View style={styles.row}>
            <Chip
              label="No date"
              selected={targetDay === null}
              onPress={() => setTargetDay(null)}
            />
            {/* iOS and web have no dialog to dismiss: the compact picker is a field that
                opens and closes its own overlay, so it sits in the row where
                the "pick a date" chip would be. Android's picker *is* a dialog,
                so there the chip stays and opens it. */}
            {Platform.OS !== 'android' ? (
              <DateTimePicker
                value={fromDayKey(targetDay ?? defaultTargetDay())}
                mode="date"
                display="compact"
                themeVariant={scheme}
                accentColor={theme.accent}
                style={styles.datePicker}
                onValueChange={(_, date) => {
                  if (date) setTargetDay(toDayKey(date));
                }}
              />
            ) : (
              <Chip
                label={targetDay ? formatDayLabel(targetDay) : 'Pick a date'}
                selected={targetDay !== null}
                onPress={() => setShowDatePicker(true)}
              />
            )}
          </View>
        </Field>

        {showDatePicker && (
          <DateTimePicker
            value={fromDayKey(targetDay ?? defaultTargetDay())}
            mode="date"
            display="default"
            onValueChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setTargetDay(toDayKey(date));
            }}
            onDismiss={() => setShowDatePicker(false)}
          />
        )}

        <Field label="Icon">
          <IconPicker
            selected={icon}
            color={slotColor(colorSlot, scheme)}
            onSelect={setIcon}
          />
        </Field>

        <Field label="Colour">
          <ColorPicker selected={colorSlot} onSelect={setColorSlot} />
        </Field>

        <Button label={isNew ? 'Create goal' : 'Save changes'} onPress={save} disabled={!canSave} />

        {!isNew && existing && <Button label="Delete goal" onPress={confirmDelete} variant="danger" />}
      </ScrollView>
    </ThemedView>
  );
}

/**
 * Where the date picker opens when no date has been chosen.
 *
 * A year out rather than today. The picker has to start *somewhere*, and
 * starting on today would put the one date a savings deadline can never be
 * under the user's thumb — every goal is in the future by definition.
 */
function defaultTargetDay(): string {
  return addDays(today(), 365);
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
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  previewName: {
    flexShrink: 1,
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
    // The native compact picker sizes itself; without this it stretches to fill
    // the row and pushes the "No date" chip out of alignment.
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
});
