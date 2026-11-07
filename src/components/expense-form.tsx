/**
 * The fast-entry form — the one screen element the whole app is built around.
 *
 * The rule it is designed against: **amount is the only field the user must
 * answer.** Everything else arrives pre-filled and correctable —
 *
 * - budget comes from the strip the user already tapped,
 * - category defaults to the last one used in that budget (the field people
 *   have no ready answer for, so we answer it for them),
 * - date defaults to today,
 * - description is optional and doubles as the search key later.
 *
 * Visually the amount is the hero: it is set at display size because typing a
 * number *is* the app, and a 16px input in a row of equal fields buries the
 * one thing that matters. The rule beneath it is the signature — it shows the
 * selected budget draining in real time as digits land, so the consequence of
 * the expense is visible before it's even submitted.
 */

import { useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import DateTimePicker from '@/components/ui/date-time-picker';
import { currencyDigits } from '@/constants/currencies';
import { ChartInk, slotColor } from '@/constants/palette';
import { FieldText, Radius, Spacing } from '@/constants/theme';
import type { ExpenseInput } from '@/data/repository';
import { useData, useQuery } from '@/data/store';
import type { Budget, Category } from '@/db/types';
import { useIsWide } from '@/hooks/use-is-wide';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDayLabel, fromDayKey, toDayKey, today } from '@/lib/date';
import { formatMoney, parseAmountToMinor, percentOf } from '@/lib/money';

export interface ExpenseFormValues {
  amount: string;
  description: string;
  budgetId: string | null;
  categoryId: string | null;
  spentOn: string;
}

export function ExpenseForm({
  budgets,
  categories,
  activeBudgetId,
  initial,
  submitLabel = 'Add expense',
  onSubmit,
}: {
  budgets: Budget[];
  categories: Category[];
  /** The budget currently selected on Home; ignored in edit mode. */
  activeBudgetId: string | null;
  initial?: ExpenseFormValues;
  submitLabel?: string;
  onSubmit: (input: ExpenseInput) => Promise<void>;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const ink = ChartInk[scheme];
  const { preferences } = useData();

  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [spentOn, setSpentOn] = useState(initial?.spentOn ?? today());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Budget and category are *derived* from their defaults until the user
   * overrides them, rather than copied into state and patched by an effect.
   * `undefined` means "untouched, keep following the default"; `null` means
   * "deliberately cleared" — that distinction is the whole mechanism that lets
   * the budget track the strip and the category track the last-used one, right
   * up until the moment the user disagrees.
   */
  const [budgetOverride, setBudgetOverride] = useState<string | undefined>(
    initial?.budgetId ?? undefined
  );
  const [categoryOverride, setCategoryOverride] = useState<string | null | undefined>(
    initial ? initial.categoryId : undefined
  );

  const budgetId = budgetOverride ?? activeBudgetId;
  const budget = budgets.find((entry) => entry.id === budgetId) ?? null;

  const { data: suggestedCategoryId } = useQuery(
    (repo) => (budgetId ? repo.lastCategoryForBudget(budgetId) : Promise.resolve(null)),
    [budgetId]
  );
  const categoryId = categoryOverride !== undefined ? categoryOverride : (suggestedCategoryId ?? null);

  const { data: progress } = useQuery((repo) => repo.budgetProgress(today()), []);
  const budgetProgress = progress?.find((entry) => entry.budget.id === budgetId) ?? null;

  const amountMinor = parseAmountToMinor(amount, preferences.currencyCode);
  const canSubmit = amountMinor !== null && budgetId !== null && !submitting;

  async function handleSubmit() {
    if (amountMinor === null || budgetId === null) return;

    // The decimal keypad has no return key and no accessory bar, so submitting
    // is the point where it has to come down on its own.
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      await onSubmit({
        budgetId,
        categoryId,
        amountMinor,
        description: description.trim() || null,
        spentOn,
      });

      if (!initial) {
        // Reset only the per-expense fields. Budget, category and date persist,
        // because the next expense is usually a sibling of the last one.
        setAmount('');
        setDescription('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const dateChips = [today(), addDays(today(), -1)];
  const currency = preferences.currencyCode;
  const symbol = formatMoney(0, currency).replace(/[\d.,\s]/g, '') || '$';
  // Yen and won have no subunit, so the decimal pad would offer a key that can
  // only ever produce an amount the form then refuses to accept.
  const decimals = currencyDigits(currency) > 0;

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <ThemedText type="display" themeColor="textMuted" style={styles.symbol}>
          {symbol}
        </ThemedText>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={theme.textMuted}
          keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
          inputMode={decimals ? 'decimal' : 'numeric'}
          // No `returnKeyType`. The decimal keypad has no return key, so asking
          // for one makes iOS synthesise an accessory toolbar just to hold it —
          // a grey bar with a lone "Done" that covers the tab bar.
          // Width tracks the digit count so the currency symbol hugs the
          // number instead of being stranded at the far left. A TextInput
          // can't size to its content, and a fixed width leaves a gap that
          // grows with every empty character slot.
          style={[
            styles.heroInput,
            { color: theme.text, width: Math.max(1, amount.length) * 32 + 8 },
          ]}
          accessibilityLabel="Amount"
        />
      </View>

      <BudgetDrain
        budget={budget}
        spentMinor={budgetProgress?.spentMinor ?? 0}
        pendingMinor={amountMinor ?? 0}
        daysLeft={budgetProgress?.daysLeft ?? 0}
        currencyCode={currency}
      />

      <View style={[styles.descriptionWrap, { backgroundColor: theme.background }]}>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What was it for?"
          placeholderTextColor={theme.textMuted}
          // Matches `expenses_description_length` in the input_bounds migration.
          maxLength={500}
          style={[styles.descriptionInput, { color: theme.text }]}
          accessibilityLabel="Description"
        />
      </View>

      <Field label="Category">
        <ChipRow>
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              color={slotColor(category.colorSlot, scheme)}
              icon={category.icon}
              selected={categoryId === category.id}
              onPress={() => setCategoryOverride(categoryId === category.id ? null : category.id)}
            />
          ))}
        </ChipRow>
      </Field>

      <Field label="Budget">
        <ChipRow>
          {budgets.map((entry) => (
            <Chip
              key={entry.id}
              label={entry.name}
              color={slotColor(entry.colorSlot, scheme)}
              selected={budgetId === entry.id}
              onPress={() => setBudgetOverride(entry.id)}
            />
          ))}
        </ChipRow>
      </Field>

      <Field label="Date">
        {/* iOS and web have no dialog to dismiss: the compact picker is a field that
            opens and closes its own overlay, so it sits in the row where the
            "pick a date" chip would be. It can't live in a ChipRow — iOS
            scrolls the native picker into view and drags the chips off the
            left edge — but two quick chips plus the picker fit without
            scrolling anyway. Android's picker *is* a dialog, so there the
            chip stays, opens it, and the row scrolls as before. */}
        {Platform.OS !== 'android' ? (
          <View style={styles.dateRow}>
            {dateChips.map((day) => (
              <Chip
                key={day}
                label={formatDayLabel(day)}
                selected={spentOn === day}
                onPress={() => setSpentOn(day)}
              />
            ))}
            <DateTimePicker
              value={fromDayKey(spentOn)}
              mode="date"
              maximumDate={new Date()}
              display="compact"
              themeVariant={scheme}
              accentColor={theme.accent}
              style={styles.datePicker}
              onValueChange={(_, date) => {
                if (date) setSpentOn(toDayKey(date));
              }}
            />
          </View>
        ) : (
          <ChipRow>
            {dateChips.map((day) => (
              <Chip
                key={day}
                label={formatDayLabel(day)}
                selected={spentOn === day}
                onPress={() => setSpentOn(day)}
              />
            ))}
            <Chip
              label={dateChips.includes(spentOn) ? 'Pick a date' : formatDayLabel(spentOn)}
              selected={!dateChips.includes(spentOn)}
              onPress={() => setShowDatePicker(true)}
            />
          </ChipRow>
        )}
      </Field>

      {showDatePicker && (
        <DateTimePicker
          value={fromDayKey(spentOn)}
          mode="date"
          maximumDate={new Date()}
          display="default"
          accentColor={theme.accent}
          onValueChange={(_, date) => {
            setShowDatePicker(false);
            if (date) setSpentOn(toDayKey(date));
          }}
          onDismiss={() => setShowDatePicker(false)}
        />
      )}

      <Button label={submitLabel} onPress={handleSubmit} disabled={!canSubmit} busy={submitting} />

      {budgetId === null && (
        <ThemedText type="label" style={{ color: ink.critical }}>
          Pick a budget to file this against.
        </ThemedText>
      )}
    </View>
  );
}

/**
 * The signature element: a budget's headroom, drawn as it drains.
 *
 * The bar shows spend already logged in solid accent and the amount currently
 * being typed as a lighter extension of it, so the consequence of the expense
 * is visible before you commit to it. Budgets without a limit have no headroom
 * to drain, so they get the running total in words instead of a bar that would
 * have to invent a denominator.
 */
function BudgetDrain({
  budget,
  spentMinor,
  pendingMinor,
  daysLeft,
  currencyCode,
}: {
  budget: Budget | null;
  spentMinor: number;
  pendingMinor: number;
  daysLeft: number;
  currencyCode: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const ink = ChartInk[scheme];

  if (!budget) return null;

  if (budget.limitMinor === null) {
    return (
      <ThemedText type="label" themeColor="textSecondary">
        {formatMoney(spentMinor + pendingMinor, currencyCode)} from {budget.name} this month
      </ThemedText>
    );
  }

  const limit = budget.limitMinor;
  const projected = spentMinor + pendingMinor;
  const remaining = limit - projected;
  const over = projected > limit;

  return (
    <View style={styles.drain}>
      <DrainBar
        spentRatio={Math.min(1, percentOf(spentMinor, limit))}
        pendingRatio={Math.min(
          1 - Math.min(1, percentOf(spentMinor, limit)),
          percentOf(pendingMinor, limit)
        )}
        color={over ? ink.critical : theme.accent}
        trackColor={ink.track}
      />

      <View style={styles.drainLabels}>
        <ThemedText type="label" themeColor={over ? 'text' : 'textSecondary'} tabular>
          {over
            ? `Over ${budget.name} by ${formatMoney(-remaining, currencyCode)}`
            : `${formatMoney(remaining, currencyCode)} left in ${budget.name}`}
        </ThemedText>
        <ThemedText type="label" themeColor="textMuted">
          {daysLeft === 0 ? 'last day' : `${daysLeft}d left`}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * The two-segment bar, animated.
 *
 * Widths are driven in pixels off the measured track rather than as percentage
 * strings, because a percentage is resolved by the layout engine on the JS side
 * — animating it would hand every frame back to the bridge, which is the one
 * thing the fills can't afford while a digit-per-keystroke drives them.
 *
 * The easing is deliberately short and decelerating: the bar has to feel like a
 * consequence of the keystroke that just landed, so it has to arrive before the
 * next digit does. The colour is animated on the same clock, so crossing the
 * limit reads as the bar turning rather than as a frame-perfect swap.
 */
function DrainBar({
  spentRatio,
  pendingRatio,
  color,
  trackColor,
}: {
  spentRatio: number;
  pendingRatio: number;
  color: string;
  trackColor: string;
}) {
  const trackWidth = useSharedValue(0);

  const spentStyle = useAnimatedStyle(() => ({
    width: withTiming(trackWidth.value * spentRatio, TIMING),
    backgroundColor: withTiming(color, TIMING),
  }));

  const pendingStyle = useAnimatedStyle(() => ({
    width: withTiming(trackWidth.value * pendingRatio, TIMING),
    backgroundColor: withTiming(color, TIMING),
  }));

  return (
    <View
      style={[styles.drainTrack, { backgroundColor: trackColor }]}
      // Measured rather than assumed: the card is inset by the screen's
      // padding, so the track's width is only known once it has been laid out.
      onLayout={(event) => {
        trackWidth.value = event.nativeEvent.layout.width;
      }}>
      <Animated.View style={[styles.drainFill, spentStyle]} />
      {/* The pending segment is the same hue at half strength, so it reads as
          "not yet real" without introducing a colour that means nothing. */}
      <Animated.View style={[styles.drainFill, styles.drainPending, pendingStyle]} />
    </View>
  );
}

const TIMING = { duration: 260, easing: Easing.out(Easing.cubic) };

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

/**
 * A row of chips: one swipeable line on a phone, wrapped lines on a wide
 * screen. A horizontal scroller is the right shape under a thumb and the wrong
 * one under a mouse, where the hidden overflow can only be reached with a
 * shift-scroll nobody knows to try.
 */
function ChipRow({ children }: { children: React.ReactNode }) {
  const wide = useIsWide();
  if (wide) return <View style={[styles.chipRow, styles.chipWrap]}>{children}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chipRow}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingTop: Spacing.two,
  },
  symbol: {
    fontSize: 22,
    lineHeight: 34,
  },
  heroInput: {
    fontSize: 56,
    lineHeight: 62,
    fontWeight: '600',
    letterSpacing: -2,
    textAlign: 'left',
    padding: 0,
  },
  drain: {
    gap: Spacing.two,
  },
  drainTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  drainFill: {
    height: 6,
  },
  drainPending: {
    opacity: 0.45,
  },
  drainLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  descriptionWrap: {
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  // Height comes from padding rather than a fixed `height`. A single-line
  // TextInput doesn't centre its text inside an explicit height — the glyphs
  // sit at the bottom and descenders clip out of the rounded box.
  descriptionInput: {
    ...FieldText,
    paddingVertical: 15,
  },
  field: {
    gap: Spacing.two,
  },
  chipRow: {
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  dateRow: {
    flexDirection: 'row',
    // Wraps only where it has to: the browser's date field is wider than the
    // native compact picker, and on a phone-width page it would otherwise run
    // off the card's right edge.
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
});
