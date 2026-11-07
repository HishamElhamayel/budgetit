/**
 * Move money between the spendable pool and a goal.
 * `/contribution/new?goalId=<uuid>` creates; `/contribution/<uuid>` edits.
 *
 * Its own route rather than a section of the goal screen, and shaped like
 * `income/[id].tsx` rather than like `budget/[id].tsx`, because it is the same
 * *kind* of thing as an income or an expense: a dated movement of money that
 * lands in the ledger, gets a row in Activity, and is edited from there. A goal
 * is defined once; this happens every payday.
 *
 * Both directions live on one screen with a toggle rather than on two routes.
 * They differ by a single field, and the day a user actually buys the car is
 * the day they need to find the *other* one — a screen that only added money
 * would leave them hunting.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import DateTimePicker from '@/components/ui/date-time-picker';
import { GlyphDisc } from '@/components/ui/glyph';
import { ChartInk, slotColor } from '@/constants/palette';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useData, useQuery } from '@/data/store';
import type { ContributionDetail, ContributionDirection } from '@/db/types';
import { useDismiss } from '@/hooks/use-dismiss';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import { addDays, formatDayLabel, fromDayKey, toDayKey, today } from '@/lib/date';
import { formatMoney, minorToInput, parseAmountToMinor } from '@/lib/money';

export default function ContributionScreen() {
  const { id, goalId } = useLocalSearchParams<{ id: string; goalId?: string }>();
  const navigation = useNavigation();
  const { goals } = useData();
  const isNew = id === 'new';

  const { data: existing, loading } = useQuery(
    (repo) => (isNew ? Promise.resolve(null) : repo.getContribution(id)),
    [id, isNew]
  );

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'Move money' : 'Edit movement' });
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
        <ThemedText style={styles.missing}>This movement no longer exists.</ThemedText>
      </ThemedView>
    );
  }

  // Reachable by deep link into `/contribution/new` on an account with no goals
  // — nothing in the app links here before one exists.
  if (isNew && goals.length === 0) {
    return (
      <ThemedView style={styles.root}>
        <ThemedText style={styles.missing}>
          Create a goal first, then you&apos;ll have somewhere to put money.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ContributionForm
      id={id}
      isNew={isNew}
      existing={existing ?? null}
      // Falls back to the first goal rather than to nothing: the chip row below
      // makes the choice visible and changeable either way, and a form that
      // opens with no goal selected cannot be submitted until the user notices
      // why.
      initialGoalId={existing?.goalId ?? goalId ?? goals[0].id}
    />
  );
}

function ContributionForm({
  id,
  isNew,
  existing,
  initialGoalId,
}: {
  id: string;
  isNew: boolean;
  existing: ContributionDetail | null;
  initialGoalId: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const dismiss = useDismiss();
  const { goals, preferences, mutate } = useData();

  const [goalId, setGoalId] = useState(initialGoalId);
  const [direction, setDirection] = useState<ContributionDirection>(existing?.direction ?? 'in');
  const [amount, setAmount] = useState(
    existing ? minorToInput(existing.amountMinor, preferences.currencyCode) : ''
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [movedOn, setMovedOn] = useState(existing?.movedOn ?? today());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // What the chosen goal holds right now, so "take money out" has a ceiling the
  // user can see. Read as of today rather than as of `movedOn`: this is the
  // balance they are moving against, not a historical reconstruction.
  const { data: progress } = useQuery((repo) => repo.goalProgress(today()), []);
  const goal = goals.find((entry) => entry.id === goalId);
  const saved = progress?.find((entry) => entry.goal.id === goalId);

  const amountMinor = parseAmountToMinor(amount, preferences.currencyCode);
  const canSave = amountMinor !== null && goal !== undefined;
  const dateChips = [today(), addDays(today(), -1)];

  const accent = goal ? slotColor(goal.colorSlot, scheme) : theme.accent;

  async function save() {
    if (amountMinor === null || !goal) return;
    const input = {
      goalId,
      amountMinor,
      direction,
      note: note.trim() || null,
      movedOn,
    };

    await mutate(async (repo) => {
      if (isNew) await repo.createContribution(input);
      else await repo.updateContribution(id, input);
    });
    dismiss();
  }

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      'Delete this movement?',
      direction === 'in'
        ? 'The money goes back into your available balance.'
        : 'The money returns to the goal.'
    );
    if (!confirmed) return;

    await mutate((repo) => repo.deleteContribution(id));
    dismiss();
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Where the money is going, and what is already there. The second half
            is the part that earns the strip: "take out" is otherwise a field
            with no visible ceiling, and the number the user needs to check is
            one screen away. */}
        {goal && (
          <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
            <GlyphDisc icon={goal.icon} color={accent} size={44} />
            <View style={styles.previewText}>
              <ThemedText type="heading" numberOfLines={1}>
                {goal.name}
              </ThemedText>
              <ThemedText type="label" themeColor="textSecondary">
                {saved
                  ? `${formatMoney(saved.savedMinor, preferences.currencyCode)} set aside${
                      goal.targetMinor !== null
                        ? ` of ${formatMoney(goal.targetMinor, preferences.currencyCode)}`
                        : ''
                    }`
                  : '—'}
              </ThemedText>
            </View>
          </View>
        )}

        <Field label="Direction">
          <View style={styles.row}>
            {/* Worded as what happens to the goal, not to the balance. "Add
                money" is what the user came to do; spelling it as "reduce
                available" would be the app describing its own bookkeeping. */}
            <Chip
              label="Add money"
              selected={direction === 'in'}
              onPress={() => setDirection('in')}
            />
            <Chip
              label="Take money out"
              selected={direction === 'out'}
              onPress={() => setDirection('out')}
            />
          </View>
          <ThemedText type="label" themeColor="textSecondary">
            {direction === 'in'
              ? 'Comes out of what you have left to spend. It isn’t spent — it’s set aside.'
              : 'Goes back into what you have left to spend.'}
          </ThemedText>
        </Field>

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
              accessibilityLabel="Amount to move"
            />
          </View>
          {/* A warning, not a block. The database permits it, the balance stays
              arithmetically correct either way, and refusing the write would
              mean arguing with a user who is reconciling against something the
              app cannot see. */}
          {direction === 'out' && amountMinor !== null && saved && amountMinor > saved.savedMinor && (
            <ThemedText type="label" style={{ color: ChartInk[scheme].critical }}>
              That&apos;s more than this goal holds.
            </ThemedText>
          )}
        </Field>

        {/* Only when there is a choice to make. One goal means one chip, which
            is a control that can only confirm what the strip above already
            says. */}
        {goals.length > 1 && (
          <Field label="Goal">
            <View style={styles.row}>
              {goals.map((entry) => (
                <Chip
                  key={entry.id}
                  label={entry.name}
                  color={slotColor(entry.colorSlot, scheme)}
                  icon={entry.icon}
                  selected={goalId === entry.id}
                  accessibilityLabel={`Goal: ${entry.name}`}
                  onPress={() => setGoalId(entry.id)}
                />
              ))}
            </View>
          </Field>
        )}

        <Field label="Note (optional)">
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Bonus, birthday money, changed my mind…"
              placeholderTextColor={theme.textSecondary}
              // Matches `goal_contributions_note_length` in the savings_goals
              // migration.
              maxLength={500}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Note"
            />
          </View>
        </Field>

        <Field label="On">
          <View style={styles.row}>
            {dateChips.map((day) => (
              <Chip
                key={day}
                label={formatDayLabel(day)}
                selected={movedOn === day}
                onPress={() => setMovedOn(day)}
              />
            ))}
            {Platform.OS !== 'android' ? (
              <DateTimePicker
                value={fromDayKey(movedOn)}
                mode="date"
                display="compact"
                themeVariant={scheme}
                accentColor={theme.accent}
                style={styles.datePicker}
                onValueChange={(_, date) => {
                  if (date) setMovedOn(toDayKey(date));
                }}
              />
            ) : (
              <Chip
                label={dateChips.includes(movedOn) ? 'Pick a date' : formatDayLabel(movedOn)}
                selected={!dateChips.includes(movedOn)}
                onPress={() => setShowDatePicker(true)}
              />
            )}
          </View>
        </Field>

        {showDatePicker && (
          <DateTimePicker
            value={fromDayKey(movedOn)}
            mode="date"
            display="default"
            onValueChange={(_, date) => {
              setShowDatePicker(false);
              if (date) setMovedOn(toDayKey(date));
            }}
            onDismiss={() => setShowDatePicker(false)}
          />
        )}

        <Button
          label={isNew ? (direction === 'in' ? 'Set it aside' : 'Take it out') : 'Save changes'}
          onPress={save}
          disabled={!canSave}
        />

        {!isNew && <Button label="Delete movement" onPress={confirmDelete} variant="danger" />}
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
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  previewText: {
    flex: 1,
    gap: Spacing.one,
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
});
