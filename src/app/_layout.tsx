import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/data/auth';
import { DataProvider, useData } from '@/data/store';
import { useDailyReminder } from '@/hooks/use-daily-reminder';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    // Required by the swipe-to-delete rows in the activity list, and it has to
    // be at the very root: gesture-handler resolves touches through this view,
    // so a Swipeable mounted outside one simply never receives the pan on
    // Android. `flex: 1` is not optional either — the default is `flex: 0`,
    // which collapses everything below it to zero height.
    <GestureHandlerRootView style={styles.flex}>
      {/* Auth is outermost of the providers: the repository stamps every write
          with a user id and reads through RLS policies keyed on the same one,
          so there is nothing for DataProvider to do until the session has
          resolved. */}
      <AuthProvider>
        <DataProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <SplashGate />
            <ReminderSync />
            <RootNavigator />
          </ThemeProvider>
        </DataProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Split out from RootLayout so it sits inside AuthProvider and can read the
 * session.
 *
 * `Stack.Protected` is a guard, not a redirect: a screen behind a false guard
 * is not registered with the navigator at all, so a deep link into
 * `/expense/123` while signed out lands on sign-in rather than momentarily
 * rendering a screen whose queries would be rejected. When the guard flips, the
 * navigator re-resolves and the user arrives where they were headed.
 */
function RootNavigator() {
  const { session, passwordRecovery } = useAuth();
  const { ready, loadError } = useData();
  // A recovery session is a real session, so `signedIn` alone would drop
  // someone who came to reset their password straight into the app with the
  // thing they came for never asked.
  const signedIn = session !== null && !passwordRecovery;

  // Stands in front of the whole stack rather than sitting inside a screen: the
  // budgets and preferences every gated screen reads are the things that failed
  // to load, so there is no screen behind here that could render honestly.
  if (signedIn && loadError && !ready) {
    return <LoadErrorScreen />;
  }

  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding"
          options={{ presentation: 'modal', title: 'Set up budgetit' }}
        />
        <Stack.Screen name="create" options={{ presentation: 'modal', title: 'Add something' }} />
        <Stack.Screen name="currency" options={{ presentation: 'modal', title: 'Currency' }} />
        {/* The whole account section is one modal with a stack of its own (see
            account/_layout.tsx). Registering its three screens directly here
            instead would push "Change email" onto *this* stack — a card sliding
            in over a presented sheet, with the sheet still behind it. */}
        <Stack.Screen name="account" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="budget/[id]" options={{ presentation: 'modal', title: 'Budget' }} />
        <Stack.Screen name="category/[id]" options={{ presentation: 'modal', title: 'Category' }} />
        <Stack.Screen name="income/[id]" options={{ presentation: 'modal', title: 'Income' }} />
        <Stack.Screen
          name="expense/[id]"
          options={{ presentation: 'modal', title: 'Edit expense' }}
        />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        {/* Shares the ungated half with sign-in, and stays registered through
            the middle of the flow: verifying the code creates a real session,
            and only `passwordRecovery` keeps `signedIn` false long enough for
            the user to actually choose a new password. */}
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Holds the splash screen until the app knows what to draw.
 *
 * That means both halves of the decision: whether there is a session, and — if
 * there is — whether the budgets and categories behind it have loaded. Lifting
 * on the first alone would show the sign-in screen for a frame on every launch
 * while the stored session was still being read off disk.
 *
 * A failed load counts as knowing what to draw. `ready` never goes true in that
 * case, so without `loadError` here the splash sits there forever and the app
 * looks hung rather than broken.
 */
function SplashGate() {
  const { initialising } = useAuth();
  const { ready, loadError } = useData();

  useEffect(() => {
    if (!initialising && (ready || loadError)) void SplashScreen.hideAsync();
  }, [initialising, ready, loadError]);

  return null;
}

/** Shown when the signed-in read failed and its retries were spent. */
function LoadErrorScreen() {
  const { loadError, reload } = useData();
  const { signOut } = useAuth();

  return (
    <ThemedView style={styles.errorRoot}>
      <View style={styles.errorBody}>
        <ThemedText type="title">Couldn&apos;t load your data</ThemedText>
        <ThemedText themeColor="textSecondary">
          {loadError?.message ?? 'Something went wrong reaching the server.'}
        </ThemedText>
        <Button label="Try again" onPress={reload} />
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </ThemedView>
  );
}

/** Keeps the daily reminder's schedule and its wording in sync with the data. */
function ReminderSync() {
  useDailyReminder();
  return null;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  errorRoot: {
    flex: 1,
    justifyContent: 'center',
  },
  errorBody: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
});
