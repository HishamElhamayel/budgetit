/**
 * Profile — settings, budget management and the reminder.
 *
 * Everything that would otherwise justify a fourth tab lives here, which is
 * what keeps the app at three — savings goals included. They are managed here
 * and *read* on Home, the same split budgets and categories already follow:
 * this screen is where a pot is defined, Home is where it is watched.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import DateTimePicker from '@/components/ui/date-time-picker';
import { DayOfMonthPicker } from '@/components/ui/day-of-month-picker';
import { GlyphDisc } from '@/components/ui/glyph';
import { findCountry } from '@/constants/countries';
import { findCurrency } from '@/constants/currencies';
import { slotColor } from '@/constants/palette';
import { BottomTabInset, MaxContentWidth, Spacing, Type } from '@/constants/theme';
import { useAuth } from '@/data/auth';
import { useData, useQuery } from '@/data/store';
import type { Budget, Goal } from '@/db/types';
import { useIsWide } from '@/hooks/use-is-wide';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmDestructive } from '@/lib/confirm';
import {
  formatDayLabel,
  formatOrdinalDay,
  formatPeriodLabel,
  formatTimeOfDay,
  periodRange,
  today,
} from '@/lib/date';
import { ensureNotificationPermission, SCHEDULING_SUPPORTED } from '@/lib/notifications';
import { formatMoney } from '@/lib/money';

export default function ProfileScreen() {
  const router = useRouter();
  const wide = useIsWide();
  const theme = useTheme();
  const scheme = useScheme();
  const { budgets, categories, goals, preferences, profile, mutate } = useData();
  const { user, pendingEmail, signOut } = useAuth();

  const [showTimePicker, setShowTimePicker] = useState(false);

  const currencyName = findCurrency(preferences.currencyCode)?.name;
  const country = findCountry(profile?.countryCode);

  async function confirmSignOut() {
    const confirmed = await confirmDestructive(
      'Sign out?',
      'Your data stays in your account. Sign back in on any device to pick it up again.',
      'Sign out'
    );
    if (!confirmed) return;

    // No navigation afterwards. Clearing the session flips the root
    // navigator's guard, which unmounts this tab on its own.
    await signOut();
  }

  const { data: progress } = useQuery((repo) => repo.budgetProgress(today()), []);
  const monthTotal = (progress ?? []).reduce((sum, entry) => sum + entry.spentMinor, 0);

  const { data: goalStatus } = useQuery((repo) => repo.goalProgress(today()), []);
  const setAsideTotal = (goalStatus ?? []).reduce((sum, entry) => sum + entry.savedMinor, 0);

  const currentPeriod = periodRange(today(), preferences.periodStartDay);

  async function setReminderEnabled(enabled: boolean) {
    // Ask before writing the preference, so a denied prompt doesn't leave the
    // switch on with nothing scheduled behind it.
    if (enabled && !(await ensureNotificationPermission())) return;
    await mutate((repo) => repo.setPreferences({ reminderEnabled: enabled }));
  }

  function saveReminderTime(date: Date | undefined) {
    if (!date) return;
    void mutate((repo) =>
      repo.setPreferences({
        reminderMinuteOfDay: date.getHours() * 60 + date.getMinutes(),
      })
    );
  }

  const thisCycle = (
    <Card title="This cycle">
      <ThemedText type="title" style={styles.hero}>
        {formatMoney(monthTotal, preferences.currencyCode)}
      </ThemedText>
      <ThemedText type="label" themeColor="textSecondary">
        across {budgets.length} {budgets.length === 1 ? 'budget' : 'budgets'}
      </ThemedText>
    </Card>
  );

  const periodCard = (
    <Card title="Budget period">
      <ThemedText type="label" themeColor="textSecondary">
        Budgets restart on this day each month, and Home and Activity report the
        same span. Set it to the day you get paid — money that arrives on the 25th
        is the 25th&apos;s to spend, not the 1st&apos;s.
      </ThemedText>
      <DayOfMonthPicker
        selected={preferences.periodStartDay}
        onSelect={(day) => {
          // Null is unreachable without `followLabel` — there is nothing
          // above this setting for it to follow.
          if (day !== null) void mutate((repo) => repo.setPreferences({ periodStartDay: day }));
        }}
      />
      <ThemedText type="label" themeColor="textSecondary">
        Now: {formatPeriodLabel(currentPeriod.start, currentPeriod.end)}
      </ThemedText>
    </Card>
  );

  const reminderCard = SCHEDULING_SUPPORTED && (
    <Card title="Daily reminder">
      <View style={styles.settingRow}>
        <View style={styles.settingText}>
          <ThemedText type="label">Remind me to log expenses</ThemedText>
          <ThemedText type="label" themeColor="textSecondary">
            The reminder shows what you&apos;ve logged so far and which budget is
            tightest.
          </ThemedText>
        </View>
        <Switch value={preferences.reminderEnabled} onValueChange={setReminderEnabled} />
      </View>

      {preferences.reminderEnabled && (
        <View style={styles.settingRow}>
          <ThemedText type="label">Time</ThemedText>
          {/* iOS and web have no dialog to dismiss: the compact picker is a field
              that opens and closes its own overlay, so it sits in the row
              where the chip would be. Android's picker *is* a dialog, so
              there the chip stays and opens it. */}
          {Platform.OS !== 'android' ? (
            <DateTimePicker
              value={minuteOfDayToDate(preferences.reminderMinuteOfDay)}
              mode="time"
              display="compact"
              themeVariant={scheme}
              accentColor={theme.accent}
              onValueChange={(_, date) => saveReminderTime(date)}
            />
          ) : (
            <Chip
              label={formatTimeOfDay(preferences.reminderMinuteOfDay)}
              selected
              onPress={() => setShowTimePicker(true)}
            />
          )}
        </View>
      )}

      {showTimePicker && (
        <DateTimePicker
          value={minuteOfDayToDate(preferences.reminderMinuteOfDay)}
          mode="time"
          display="default"
          onValueChange={(_, date) => {
            setShowTimePicker(false);
            saveReminderTime(date);
          }}
          onDismiss={() => setShowTimePicker(false)}
        />
      )}
    </Card>
  );

  const budgetsCard = (
    <Card
      title="Budgets"
      action={
        <ThemedText
          type="label"
          themeColor="textSecondary"
          onPress={() => router.push('/budget/new')}>
          Add
        </ThemedText>
      }>
      {budgets.map((budget) => (
        <Pressable
          key={budget.id}
          onPress={() => router.push(`/budget/${budget.id}`)}
          style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
          <View
            style={[styles.dot, { backgroundColor: slotColor(budget.colorSlot, scheme) }]}
          />
          {/* Both sides capped to a line. A `flex: 1` Text with an
              unbounded sibling wraps per *character* rather than
              truncating, which turned a long summary into a vertical
              column of letters. */}
          <ThemedText style={styles.listLabel} numberOfLines={1}>
            {budget.name}
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
            {budgetSummary(budget, preferences.currencyCode)}
          </ThemedText>
        </Pressable>
      ))}
    </Card>
  );

  const goalsCard = (
    <Card
      title="Goals"
      action={
        <ThemedText
          type="label"
          themeColor="textSecondary"
          onPress={() => router.push('/goal/new')}>
          Add
        </ThemedText>
      }>
      {goals.length === 0 ? (
        <ThemedText type="label" themeColor="textSecondary">
          Saving up for something? A goal holds money back from what you have
          left to spend, without it counting as spent.
        </ThemedText>
      ) : (
        <>
          {goals.map((goal) => (
            <Pressable
              key={goal.id}
              onPress={() => router.push(`/goal/${goal.id}`)}
              style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
              {/* The icon disc rather than the dot the budget rows use.
                  Goals carry one and budgets don't, and drawing it here
                  is what keeps the two lists from reading as one. */}
              <GlyphDisc
                icon={goal.icon}
                color={slotColor(goal.colorSlot, scheme)}
                size={26}
              />
              <ThemedText style={styles.listLabel} numberOfLines={1}>
                {goal.name}
              </ThemedText>
              <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
                {goalSummary(goal, preferences.currencyCode)}
              </ThemedText>
            </Pressable>
          ))}
          <ThemedText type="label" themeColor="textSecondary">
            {formatMoney(setAsideTotal, preferences.currencyCode)} set aside in total,
            and held back from what Home says you have left.
          </ThemedText>
        </>
      )}
    </Card>
  );

  const categoriesCard = (
    <Card
      title="Categories"
      action={
        <ThemedText
          type="label"
          themeColor="textSecondary"
          onPress={() => router.push('/category/new')}>
          Add
        </ThemedText>
      }>
      <View style={styles.chipWrap}>
        {categories.map((category) => (
          <Chip
            key={category.id}
            label={category.name}
            color={slotColor(category.colorSlot, scheme)}
            icon={category.icon}
            onPress={() => router.push(`/category/${category.id}`)}
          />
        ))}
      </View>
      <ThemedText type="label" themeColor="textSecondary">
        Categories are shared across every budget — they answer &quot;what did I
        buy&quot;, while budgets answer &quot;which pot paid for it&quot;.
      </ThemedText>
    </Card>
  );

  const currencyCard = (
    <Card title="Currency">
      <Pressable
        onPress={() => router.push('/currency')}
        accessibilityRole="button"
        accessibilityLabel="Change currency"
        style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}>
        <View style={styles.settingText}>
          <ThemedText type="label">
            {preferences.currencyCode}
            {currencyName ? ` · ${currencyName}` : ''}
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary">
            Changes how amounts are written. Nothing already logged is converted.
          </ThemedText>
        </View>
        <ThemedText type="body" themeColor="textSecondary">
          ›
        </ThemedText>
      </Pressable>
    </Card>
  );

  const accountCard = (
    <Card title="Account">
      <Pressable
        onPress={() => router.push('/account')}
        accessibilityRole="button"
        accessibilityLabel="Edit your account"
        style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}>
        <View style={styles.settingText}>
          <ThemedText type="label">{profile?.fullName ?? 'Add your name'}</ThemedText>
          <ThemedText type="label" themeColor="textSecondary">
            {user?.email ?? 'Unknown account'}
            {country ? ` · ${country.name}` : ''}
          </ThemedText>
          {/* Only worth a line when there is something in flight — a
              change started days ago on another device shows up here
              without the user having to go looking for it. */}
          {pendingEmail && (
            <ThemedText type="label" themeColor="accentInk">
              Unfinished change to {pendingEmail} — tap to enter the code
            </ThemedText>
          )}
        </View>
        <ThemedText type="body" themeColor="textSecondary">
          ›
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={confirmSignOut}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.outlineButton,
          { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
        ]}>
        <ThemedText type="label">Sign out</ThemedText>
      </Pressable>
    </Card>
  );

  const footer = (
    <ThemedText type="label" style={[styles.footer, { color: theme.textSecondary }]}>
      Synced to your account. Only you can read it.
    </ThemedText>
  );

  // Built once and arranged per layout, like Home. A phone reads one column in
  // the order below; a wide window splits it into the things the user keeps
  // (budgets, goals, categories) and the settings that shape how they're shown.
  if (wide) {
    return (
      <ThemedView style={styles.root}>
        <ScrollView contentContainerStyle={styles.wideContent}>
          <View style={styles.wideColumn}>
            {thisCycle}
            {budgetsCard}
            {goalsCard}
            {categoriesCard}
          </View>
          <View style={styles.wideColumn}>
            {periodCard}
            {reminderCard}
            {currencyCard}
            {accountCard}
            {footer}
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          {thisCycle}
          {periodCard}
          {reminderCard}
          {budgetsCard}
          {goalsCard}
          {categoriesCard}
          {currencyCard}
          {accountCard}
          {footer}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * The trailing line on a budget row: its limit, and its own restart day where
 * it has one.
 *
 * The day is only spelled out for budgets that pinned one. Printing it on every
 * row would bury the exception — the whole point of the list is to make a
 * budget that *doesn't* follow the app-wide period stand out.
 */
function budgetSummary(budget: Budget, currencyCode: string): string {
  const limit =
    budget.limitMinor === null
      ? 'No limit'
      : `${formatMoney(budget.limitMinor, currencyCode)} / ${budget.cycle === 'weekly' ? 'week' : 'month'}`;

  // `== null` deliberately, to catch the `undefined` a pre-migration database
  // hands back as well as a genuine "follows the app-wide period".
  if (budget.cycle === 'weekly' || budget.resetDay == null) return limit;
  return `${limit} · resets ${formatOrdinalDay(budget.resetDay)}`;
}

/**
 * The trailing line on a goal row: its target, and its date where it has one.
 *
 * Deliberately the target rather than the progress. This list is for *editing*
 * goals — the progress bars on Home are where they are read — and repeating the
 * running total here would make the two places disagree the moment one of them
 * is looking at a different day.
 */
function goalSummary(goal: Goal, currencyCode: string): string {
  const target =
    goal.targetMinor === null ? 'No target' : formatMoney(goal.targetMinor, currencyCode);

  if (goal.targetDay === null) return target;
  return `${target} · by ${formatDayLabel(goal.targetDay)}`;
}

function minuteOfDayToDate(minuteOfDay: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return date;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.three,
  },
  wideContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: Spacing.six - Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.six,
  },
  wideColumn: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.three,
  },
  hero: {
    ...Type.figure,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  settingText: {
    flex: 1,
    gap: Spacing.one,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  listLabel: {
    flex: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  outlineButton: {
    height: 44,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    textAlign: 'center',
    paddingTop: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
