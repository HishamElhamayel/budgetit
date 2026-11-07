/**
 * The retention hook.
 *
 * A reminder that only says "log your expenses" gets swiped away by week two,
 * so the body carries real numbers instead. A `DAILY` trigger repeats with a
 * fixed body, which means the text is only as fresh as the last time we
 * scheduled it — so the reminder is rebuilt every time the app backgrounds
 * (see hooks/use-daily-reminder.ts). That's accurate to within one session,
 * which is close enough for a nudge and costs nothing.
 *
 * Local scheduled notifications work in Expo Go on both platforms; only *push*
 * is unavailable there on Android since SDK 53. This app only schedules
 * locally, so no development build is required.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Repository } from '@/data/repository';
import { today } from '@/lib/date';
import { formatMoney } from '@/lib/money';

const ANDROID_CHANNEL_ID = 'daily-reminder';

/**
 * Scheduling is native-only — `cancelAllScheduledNotificationsAsync` and
 * friends throw outright on web rather than no-oping. Every entry point below
 * bails early, and screens read this to hide the reminder settings entirely:
 * a switch that can never schedule anything is worse than no switch.
 *
 * A browser reminder would need Web Push, which means a server sending on a
 * schedule — local scheduling has no web equivalent.
 */
export const SCHEDULING_SUPPORTED = Platform.OS !== 'web';

if (SCHEDULING_SUPPORTED) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!SCHEDULING_SUPPORTED) return false;

  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted
    ? existing
    : await Notifications.requestPermissionsAsync();

  if (status.granted && Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Daily reminder',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  return status.granted;
}

/**
 * Builds a body worth reading from the day's actual numbers.
 *
 * `name` only reaches the title. A notification that opens with the reader's
 * name is the one they look at rather than swipe, but a body that also uses it
 * tips straight over into the tone of a marketing push — which is the thing
 * this reminder is trying not to be.
 */
export async function buildReminderBody(
  repo: Repository,
  currencyCode: string,
  name?: string | null
): Promise<{ title: string; body: string }> {
  const summary = await repo.daySummary(today());

  const spendLine =
    summary.expenseCount === 0
      ? 'Nothing logged today.'
      : `${formatMoney(summary.totalMinor, currencyCode)} logged today across ${
          summary.expenseCount
        } ${summary.expenseCount === 1 ? 'expense' : 'expenses'}.`;

  const budgetLine = summary.tightestBudget
    ? summary.tightestBudget.remainingMinor < 0
      ? ` ${summary.tightestBudget.name} is over by ${formatMoney(
          -summary.tightestBudget.remainingMinor,
          currencyCode
        )}.`
      : ` ${summary.tightestBudget.name} has ${formatMoney(
          summary.tightestBudget.remainingMinor,
          currencyCode
        )} left.`
    : '';

  // Written as two whole phrases rather than one with the name spliced in, so
  // the punctuation stays right in both cases — "Anything to log, Hisham?"
  // needs the comma inside the question, and "Anything to log?, Hisham" is what
  // an appended name would produce.
  const title = name
    ? summary.expenseCount === 0
      ? `Anything to log, ${name}?`
      : `Today so far, ${name}`
    : summary.expenseCount === 0
      ? 'Anything to log?'
      : 'Today so far';

  return { title, body: `${spendLine}${budgetLine}` };
}

/**
 * Replace the scheduled reminder. Cancelling everything first keeps this
 * idempotent — without it, every reschedule would stack another notification.
 */
export async function scheduleDailyReminder(
  repo: Repository,
  options: { minuteOfDay: number; currencyCode: string; name?: string | null }
): Promise<void> {
  if (!SCHEDULING_SUPPORTED) return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  const granted = await ensureNotificationPermission();
  if (!granted) return;

  const { title, body } = await buildReminderBody(repo, options.currencyCode, options.name);

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.floor(options.minuteOfDay / 60),
      minute: options.minuteOfDay % 60,
    },
  });
}

export async function cancelDailyReminder(): Promise<void> {
  if (!SCHEDULING_SUPPORTED) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}
