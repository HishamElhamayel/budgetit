import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DialogFrame } from '@/components/dialog-frame';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/data/auth';
import { DataProvider, useData } from '@/data/store';
import { useDailyReminder } from '@/hooks/use-daily-reminder';
import { useIsWide } from '@/hooks/use-is-wide';

SplashScreen.preventAutoHideAsync();

/**
 * What sits underneath a form opened straight from a URL. Without an anchor a
 * pasted `/budget/123` is the only route on the stack — a dialog over nothing,
 * and a sheet whose dismissal has nowhere to go back to.
 */
export const unstable_settings = { anchor: '(tabs)' };

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
  const wide = useIsWide();
  const { session, passwordRecovery, initialising } = useAuth();
  const { ready, loadError } = useData();
  // A recovery session is a real session, so `signedIn` alone would drop
  // someone who came to reset their password straight into the app with the
  // thing they came for never asked.
  const signedIn = session !== null && !passwordRecovery;

  // Both halves stay registered until the stored session has been read. With
  // the signed-in half unregistered for those first milliseconds, a URL like
  // `/activity` has no screen to resolve to and the navigator falls back to
  // its first route — so on the web, refreshing any page dropped the user on
  // Home. Holding the guards open lets the URL resolve; once the session is
  // known they close exactly as before, sending a signed-out visitor to
  // sign-in.
  const showSignedIn = initialising || signedIn;
  const showSignedOut = initialising || !signedIn;

  // Stands in front of the whole stack rather than sitting inside a screen: the
  // budgets and preferences every gated screen reads are the things that failed
  // to load, so there is no screen behind here that could render honestly.
  if (signedIn && loadError && !ready) {
    return <LoadErrorScreen />;
  }

  // Each form is one of two presentations of the same route: a sheet on a
  // phone, a dialog over the page on a wide browser (see dialog-frame.tsx).
  // As a dialog the route draws no stack header — the frame's title bar takes
  // its place — and appears without the sheet's slide, which on a desktop reads
  // as the whole page moving.
  const form = (title?: string) =>
    wide
      ? ({ presentation: 'transparentModal', headerShown: false, animation: 'none', title } as const)
      : ({ presentation: 'modal', title } as const);

  return (
    <Stack
      screenLayout={({ children, route, options }) => {
        const dialog = DIALOGS[route.name];
        if (!dialog) return children;
        return (
          <FormGate>
            {wide ? (
              <DialogFrame
                title={dialog.ownHeader ? undefined : options.title}
                dismissible={dialog.dismissible ?? true}>
                {children}
              </DialogFrame>
            ) : (
              children
            )}
          </FormGate>
        );
      }}>
      <Stack.Protected guard={showSignedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={form('Set up budgetit')} />
        <Stack.Screen name="create" options={form('Add something')} />
        <Stack.Screen name="currency" options={form('Currency')} />
        {/* The whole account section is one modal with a stack of its own (see
            account/_layout.tsx). Registering its three screens directly here
            instead would push "Change email" onto *this* stack — a card sliding
            in over a presented sheet, with the sheet still behind it. */}
        <Stack.Screen name="account" options={{ ...form(), headerShown: false }} />
        <Stack.Screen name="budget/[id]" options={form('Budget')} />
        <Stack.Screen name="goal/[id]" options={form('Goal')} />
        {/* Separate from `goal/[id]`, because it is a different kind of act:
            one defines the goal, the other moves money into it. See the header
            of contribution/[id].tsx. */}
        <Stack.Screen name="contribution/[id]" options={form('Move money')} />
        <Stack.Screen name="category/[id]" options={form('Category')} />
        <Stack.Screen name="income/[id]" options={form('Income')} />
        <Stack.Screen name="expense/[id]" options={form('Edit expense')} />
      </Stack.Protected>

      <Stack.Protected guard={showSignedOut}>
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
 * Holds a form back until the data it edits has loaded.
 *
 * Every form seeds its fields once, from the row it was opened on — `useState`
 * initial values, not effects — which is right when it opens from a tap, with
 * the data long since loaded. Opened from a link instead (a bookmark, a
 * refresh, a pasted URL) it mounts first, finds no row, and comes up blank with
 * "Save" ready to overwrite the real thing with nothing. Waiting the moment it
 * takes for the first read means every field starts from what's stored.
 */
function FormGate({ children }: { children: React.ReactNode }) {
  const { ready } = useData();
  return ready ? <>{children}</> : <ThemedView style={styles.flex} />;
}

/**
 * The routes that present as dialogs on wide web, and how.
 *
 * `ownHeader` is for the account section, whose nested stack already draws a
 * header with a back button; the frame adds only a close button beside it.
 * Onboarding can't be dismissed — Home would only redirect straight back.
 */
const DIALOGS: Record<string, { ownHeader?: boolean; dismissible?: boolean }> = {
  onboarding: { dismissible: false },
  create: {},
  currency: {},
  account: { ownHeader: true },
  'budget/[id]': {},
  'goal/[id]': {},
  'contribution/[id]': {},
  'category/[id]': {},
  'income/[id]': {},
  'expense/[id]': {},
};

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
