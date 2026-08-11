import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/data/auth';
import { useData } from '@/data/store';
import { greetingName } from '@/lib/name';
import { cancelDailyReminder, scheduleDailyReminder } from '@/lib/notifications';

/**
 * Keeps the scheduled reminder in sync with the user's settings and with the
 * day's actual spend.
 *
 * Rescheduling happens on mount, whenever the reminder settings change, and
 * every time the app leaves the foreground — that last one is what keeps the
 * notification body from going stale, since a DAILY trigger repeats fixed text.
 */
export function useDailyReminder() {
  const { repo, preferences, profile, ready } = useData();
  const { session } = useAuth();

  const signedIn = session !== null;
  const enabled = preferences.reminderEnabled;
  const minute = preferences.reminderMinuteOfDay;
  const currency = preferences.currencyCode;
  // Pulled out as a primitive rather than passing `profile` through, so the
  // effect below reschedules when the *name* changes and not every time the
  // store hands back a new profile object.
  const name = greetingName(profile?.fullName);

  useEffect(() => {
    if (!ready) return;

    async function sync() {
      // Signing out swaps in a repository that rejects every call, but the
      // cached preferences are cleared a tick later — for that one render the
      // reminder still reads as enabled. Scheduling here would call
      // `daySummary` on the stub and reject. Checking the session rather than
      // waiting for the preferences to catch up closes that window, and
      // cancelling is the right behaviour anyway: a signed-out app should not
      // be telling anyone what they spent.
      if (!signedIn || !enabled) {
        await cancelDailyReminder();
        return;
      }

      await scheduleDailyReminder(repo, {
        minuteOfDay: minute,
        currencyCode: currency,
        name,
      });
    }

    // Reads go over the network now, so a failure here is routine — a flaky
    // connection, a token mid-refresh. This is a background side effect nobody
    // is waiting on, and an uncaught rejection would put a red box over the app
    // for something the next foreground event retries anyway.
    const run = () => {
      void sync().catch((error: unknown) => {
        console.warn('[budgetit] could not sync the daily reminder', error);
      });
    };

    run();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') run();
    });

    return () => subscription.remove();
  }, [repo, ready, signedIn, enabled, minute, currency, name]);
}
