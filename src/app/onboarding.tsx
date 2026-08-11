/**
 * First run — two explainers, then setup.
 *
 * The explainers earn their place by teaching the one thing about this app that
 * isn't guessable: that an expense is filed on *two* axes. Everything else
 * (tap amount, press add) is discoverable, so it gets one screen and no more.
 * Skip jumps straight to setup, because a returning user reinstalling doesn't
 * need the lecture.
 *
 * Setup is the only step that can't be skipped: Home's form needs at least one
 * budget to file against, so a user arriving with none would find a form that
 * can't submit.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LogItArt, TwoAxesArt } from '@/components/onboarding-art';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Chip } from '@/components/ui/chip';
import { findCountry } from '@/constants/countries';
import { slotColor } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import { nowIso } from '@/db/ids';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatTimeOfDay } from '@/lib/date';
import { ensureNotificationPermission } from '@/lib/notifications';

/** Envelope-shaped by design: pots money comes *from*, not kinds of purchase. */
const SUGGESTED = ['Living', 'Personal', 'Savings', 'Other'];

const STEP_COUNT = 3;

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useScheme();
  const { mutate, preferences, profile } = useData();

  /**
   * The currency this account starts on, taken from the country given at
   * sign-up. Stated on screen rather than applied silently: a guess the user
   * can see is a guess they can correct, and one they can't see is a bug report
   * about the app showing dollars to someone in Cairo.
   *
   * Falls back to whatever preferences already hold — the USD default for
   * anyone who skipped the country field, and their existing choice for anyone
   * arriving here a second time.
   */
  const startingCurrency =
    findCountry(profile?.countryCode)?.currencyCode ?? preferences.currencyCode;

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(SUGGESTED.slice(0, 3));
  const [customName, setCustomName] = useState('');
  const [wantsReminder, setWantsReminder] = useState(true);
  const [reminderMinute, setReminderMinute] = useState(preferences.reminderMinuteOfDay);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [busy, setBusy] = useState(false);

  function toggle(name: string) {
    setSelected((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]
    );
  }

  function addCustom() {
    const name = customName.trim();
    // Case-insensitive so "savings" can't quietly become a second "Savings".
    if (!name || selected.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      setCustomName('');
      return;
    }
    setSelected((current) => [...current, name]);
    setCustomName('');
  }

  async function finish() {
    if (selected.length === 0 || busy) return;

    // Setup already ran (a double tap, or a stale mount): leave rather than
    // creating a second set of budgets. Navigating instead of returning
    // silently matters — a button that does nothing reads as broken.
    if (preferences.onboardingCompletedAt) {
      router.replace('/');
      return;
    }

    setBusy(true);
    try {
      const reminderGranted = wantsReminder ? await ensureNotificationPermission() : false;

      await mutate(async (repo) => {
        for (const [index, name] of selected.entries()) {
          await repo.createBudget({ name, limitMinor: null, cycle: 'monthly', colorSlot: index });
        }
        await repo.setPreferences({
          onboardingCompletedAt: nowIso(),
          reminderEnabled: reminderGranted,
          reminderMinuteOfDay: reminderMinute,
          currencyCode: startingCurrency,
        });
      });

      router.replace('/');
    } finally {
      setBusy(false);
    }
  }

  const isLast = step === STEP_COUNT - 1;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <Explainer
              art={<LogItArt />}
              title="Logging takes five seconds"
              body="Type an amount and press add — that's the whole thing. The date, the budget and the category are already filled in, and you only touch them when they're wrong. The charts underneath redraw as you go."
            />
          )}

          {step === 1 && (
            <Explainer
              art={<TwoAxesArt />}
              title="Two questions, not one"
              body="A budget is the pot the money came out of. A category is what you actually bought. Keeping them apart is what lets you ask “how much is left in Personal” and “how much do I spend on food” at the same time."
            />
          )}

          {step === 2 && (
            <View style={styles.setup}>
              <View style={styles.intro}>
                <ThemedText type="title">Set up your pots</ThemedText>
                <ThemedText type="label" themeColor="textSecondary">
                  Pick the ones that fit, or add your own. Limits and colours can wait — you
                  can change all of this later.
                </ThemedText>
                <ThemedText type="label" themeColor="textMuted">
                  Amounts will be written in {startingCurrency}. Change it any time from
                  Profile.
                </ThemedText>
              </View>

              <View style={styles.chipWrap}>
                {[...SUGGESTED, ...selected.filter((name) => !SUGGESTED.includes(name))].map(
                  (name, index) => (
                    <Chip
                      key={name}
                      label={name}
                      color={slotColor(index, scheme)}
                      selected={selected.includes(name)}
                      onPress={() => toggle(name)}
                    />
                  )
                )}
              </View>

              <View style={styles.addRow}>
                <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
                  <TextInput
                    value={customName}
                    onChangeText={setCustomName}
                    onSubmitEditing={addCustom}
                    placeholder="Add your own…"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                    style={[styles.input, { color: theme.text }]}
                    accessibilityLabel="New budget name"
                  />
                </View>
                <Pressable
                  onPress={addCustom}
                  disabled={!customName.trim()}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.addButton,
                    {
                      backgroundColor: theme.backgroundSelected,
                      opacity: customName.trim() ? (pressed ? 0.7 : 1) : 0.35,
                    },
                  ]}>
                  <ThemedText type="label">Add</ThemedText>
                </Pressable>
              </View>

              <View style={styles.reminderBlock}>
                <View style={styles.settingRow}>
                  <View style={styles.settingText}>
                    <ThemedText type="label">Remind me once a day</ThemedText>
                    <ThemedText type="label" themeColor="textSecondary">
                      The reminder tells you what you&apos;ve spent so far and which budget is
                      tightest — not just &quot;open the app&quot;.
                    </ThemedText>
                  </View>
                  <Switch value={wantsReminder} onValueChange={setWantsReminder} />
                </View>

                {wantsReminder && (
                  <View style={styles.settingRow}>
                    <ThemedText type="label">At</ThemedText>
                    {/* iOS has no dialog to dismiss: the compact picker is a
                        field that opens and closes its own overlay, so it sits
                        in the row where the chip would be. Android's picker
                        *is* a dialog, so there the chip stays and opens it. */}
                    {Platform.OS === 'ios' ? (
                      <DateTimePicker
                        value={minuteOfDayToDate(reminderMinute)}
                        mode="time"
                        display="compact"
                        themeVariant={scheme}
                        accentColor={theme.accent}
                        onValueChange={(_, date) => {
                          if (date) setReminderMinute(date.getHours() * 60 + date.getMinutes());
                        }}
                      />
                    ) : (
                      <Chip
                        label={formatTimeOfDay(reminderMinute)}
                        selected
                        onPress={() => setShowTimePicker(true)}
                      />
                    )}
                  </View>
                )}

                {showTimePicker && (
                  <DateTimePicker
                    value={minuteOfDayToDate(reminderMinute)}
                    mode="time"
                    display="default"
                    onValueChange={(_, date) => {
                      setShowTimePicker(false);
                      if (date) setReminderMinute(date.getHours() * 60 + date.getMinutes());
                    }}
                    onDismiss={() => setShowTimePicker(false)}
                  />
                )}
              </View>

              {selected.length === 0 && (
                <ThemedText type="label" themeColor="textSecondary">
                  Pick at least one budget to carry on — expenses need somewhere to go.
                </ThemedText>
              )}
            </View>
          )}

          <View style={styles.footer}>
            <Dots count={STEP_COUNT} active={step} />

            <Pressable
              onPress={() => (isLast ? finish() : setStep(step + 1))}
              disabled={isLast && (selected.length === 0 || busy)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cta,
                {
                  backgroundColor: theme.text,
                  opacity: isLast && (selected.length === 0 || busy) ? 0.35 : pressed ? 0.8 : 1,
                },
              ]}>
              <ThemedText type="label" style={{ color: theme.background }}>
                {isLast ? 'Start tracking' : 'Next'}
              </ThemedText>
            </Pressable>

            {!isLast && (
              <Pressable
                onPress={() => setStep(STEP_COUNT - 1)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
                <ThemedText type="label" themeColor="textSecondary">
                  Skip
                </ThemedText>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Explainer({
  art,
  title,
  body,
}: {
  art: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.explainer}>
      <View style={styles.art}>{art}</View>
      <ThemedText type="title" style={styles.explainerTitle}>
        {title}
      </ThemedText>
      <ThemedText type="label" themeColor="textSecondary" style={styles.explainerBody}>
        {body}
      </ThemedText>
    </View>
  );
}

function Dots({ count, active }: { count: number; active: number }) {
  const theme = useTheme();

  return (
    <View style={styles.dots} accessibilityRole="progressbar" accessibilityValue={{ now: active + 1, max: count }}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            index === active
              ? { backgroundColor: theme.text, width: 18 }
              : { backgroundColor: theme.backgroundSelected },
          ]}
        />
      ))}
    </View>
  );
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
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.four,
    justifyContent: 'space-between',
  },
  explainer: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.five,
  },
  art: {
    alignItems: 'center',
    paddingBottom: Spacing.three,
  },
  explainerTitle: {
    textAlign: 'center',
  },
  explainerBody: {
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
  },
  setup: {
    flex: 1,
    gap: Spacing.four,
    paddingTop: Spacing.three,
  },
  intro: {
    gap: Spacing.two,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  addRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  inputWrap: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 12,
  },
  addButton: {
    paddingHorizontal: Spacing.four,
    height: 44,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderBlock: {
    gap: Spacing.three,
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
  footer: {
    gap: Spacing.two,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cta: {
    height: 48,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skip: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
