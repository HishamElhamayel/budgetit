/**
 * Sign in / sign up — the only screen reachable without a session.
 *
 * One screen for both modes rather than two routes. The credential fields are
 * identical, and someone who mistypes an email on sign-up should be able to
 * switch to sign-in without retyping it, which a navigation between two screens
 * throws away. `mode` swaps the copy, adds the two profile fields, and changes
 * which call fires; nothing else moves.
 *
 * Sign-up asks for a name and, optionally, a country. Both are asked here
 * rather than during onboarding because this is the only screen the user
 * already expects to be a form — onboarding is a sequence of decisions about
 * *budgets*, and a name field wedged into it reads as an interruption. The
 * country is what onboarding then uses to pre-select a currency, so asking for
 * it a screen earlier is what lets the next screen guess correctly.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryField } from '@/components/country-picker';
import { PasswordChecklist } from '@/components/password-checklist';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ChartInk } from '@/constants/palette';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/data/auth';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { MIN_PASSWORD_LENGTH, checkPassword, passwordAccepted } from '@/lib/password';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const theme = useTheme();
  const scheme = useScheme();
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set after a successful action that needs the user to go and check email. */
  const [notice, setNotice] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  // Deliberately not a full RFC-5322 regex: the only job here is to catch a
  // missing @ before spending a round trip. The server is the real validator.
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  // Any non-empty name will do. A minimum length looks like diligence and is
  // really just a guess about other people's names — single-character given
  // names are real, and the field is a greeting, not an identity document.
  const nameGiven = fullName.trim().length > 0;

  const passwordRules = useMemo(
    () => checkPassword(password, { email: trimmedEmail, name: fullName }),
    [password, trimmedEmail, fullName]
  );
  // The policy applies to passwords being *chosen*. Holding sign-in to it would
  // lock out every account created before the rules tightened, over a password
  // the server is perfectly happy with — so signing in only needs something
  // typed, and the server judges it.
  const passwordUsable = mode === 'sign-in' ? password.length > 0 : passwordAccepted(passwordRules);

  const canSubmit = emailLooksValid && passwordUsable && (mode === 'sign-in' || nameGiven) && !busy;

  function switchMode(next: Mode) {
    setMode(next);
    // Carrying a "wrong password" error across to the sign-up form would be
    // nonsense; the email and password themselves are kept on purpose.
    setError(null);
    setNotice(null);
  }

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result =
        mode === 'sign-in'
          ? await signIn(email, password)
          : await signUp(email, password, { fullName, countryCode });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.needsEmailConfirmation) {
        setNotice(`Almost there — open the link we sent to ${trimmedEmail} to finish setting up.`);
        return;
      }

      // No navigation on success. The session lands in AuthProvider, the root
      // navigator's guard flips, and this screen unmounts on its own. Pushing a
      // route here would race that and log a "navigate before mount" warning.
    } finally {
      setBusy(false);
    }
  }

  /**
   * Hand off to the reset screen, which owns the whole three-step flow — it
   * would otherwise turn this screen into a state machine with four modes.
   *
   * The typed email is deliberately not passed along. It would have to travel
   * as a route parameter, which on web means a user's address sitting in the
   * URL bar and the browser history for the sake of saving one field.
   */
  function forgotPassword() {
    router.push('/reset-password');
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
            <View style={styles.header}>
              <ThemedText type="title">
                {mode === 'sign-in' ? 'Welcome back' : 'Start budgeting'}
              </ThemedText>
              <ThemedText type="body" themeColor="textSecondary">
                {mode === 'sign-in'
                  ? 'Sign in to pick up where you left off.'
                  : 'Create an account and your budgets follow you to every device.'}
              </ThemedText>
            </View>

            <View style={styles.form}>
              {mode === 'sign-up' && (
                <Field label="Name">
                  <TextInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="What should we call you?"
                    placeholderTextColor={theme.textMuted}
                    // `words` rather than `sentences`: a name is capitalised
                    // per word, and the keyboard shifting back down after the
                    // first one is what produces "Hisham elhamayel".
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="name"
                    textContentType="name"
                    returnKeyType="next"
                    maxLength={80}
                    style={[
                      styles.input,
                      { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                    ]}
                    accessibilityLabel="Name"
                  />
                </Field>
              )}

              <Field label="Email">
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  inputMode="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}
                  accessibilityLabel="Email"
                />
              </Field>

              <Field label="Password">
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={
                    mode === 'sign-in'
                      ? 'Your password'
                      : `At least ${MIN_PASSWORD_LENGTH} characters`
                  }
                  placeholderTextColor={theme.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  // `newPassword` on sign-up is what prompts the keychain to
                  // offer a generated password instead of trying to fill an
                  // existing one that doesn't exist yet.
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}
                  accessibilityLabel="Password"
                />
              </Field>

              {/* Sign-up only, and only once there is something to judge. The
                  rules under an untouched field are a wall of text in front of
                  a form; from the first keystroke they are feedback. */}
              {mode === 'sign-up' && password.length > 0 && (
                <PasswordChecklist rules={passwordRules} />
              )}

              {/* Last, and optional. An optional field placed above a required
                  one is a speed bump in front of the thing they came to do. */}
              {mode === 'sign-up' && (
                <Field label="Country" hint="Optional — sets the currency we start you on.">
                  <CountryField value={countryCode} onChange={setCountryCode} />
                </Field>
              )}

              {error && (
                <ThemedText
                  type="label"
                  style={{ color: ChartInk[scheme].critical }}
                  accessibilityRole="alert">
                  {error}
                </ThemedText>
              )}

              {notice && (
                <ThemedText type="label" themeColor="accentInk" accessibilityRole="alert">
                  {notice}
                </ThemedText>
              )}

              <Button
                label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
                onPress={() => void submit()}
                disabled={!canSubmit}
                busy={busy}
              />

              {mode === 'sign-in' && (
                <Pressable
                  onPress={forgotPassword}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
                  <ThemedText type="label" themeColor="textSecondary">
                    Forgot your password?
                  </ThemedText>
                </Pressable>
              )}
            </View>

            <View style={styles.footer}>
              <ThemedText type="label" themeColor="textSecondary">
                {mode === 'sign-in' ? 'No account yet?' : 'Already have an account?'}
              </ThemedText>
              <Pressable
                onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
                <ThemedText type="label" themeColor="accentInk">
                  {mode === 'sign-in' ? 'Create one' : 'Sign in instead'}
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Sits under the control, where it can't be mistaken for the label. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
      {hint && (
        <ThemedText type="label" themeColor="textMuted">
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
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
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  header: {
    gap: Spacing.two,
  },
  form: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
  // Height comes from padding rather than a fixed `height`. A single-line
  // TextInput doesn't centre its text inside an explicit height — the glyphs
  // sit at the bottom and descenders clip out of the rounded box. 16 + 20 + 16
  // lands on the same 52pt as Button, so fields and buttons still line up.
  input: {
    ...FieldText,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 16,
  },
  textButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
