/**
 * Password reset, in three steps on one screen: ask for a code, type it in,
 * choose a new password.
 *
 * One screen rather than three routes because the email address entered in the
 * first step is needed again in the second — `verifyOtp` takes the address
 * alongside the code — and threading it through navigation params would put a
 * user's email in the URL bar on web for no benefit.
 *
 * Codes, not links. A reset link has to re-enter the app through a custom URL
 * scheme, which fails in Expo Go, fails from a desktop mail client, and fails
 * silently if the redirect isn't allowlisted. A code the user retypes works
 * everywhere and has no configuration to get wrong.
 *
 * The layout is top-aligned rather than centred: the three steps are different
 * heights, and centring makes the title jump every time the user advances.
 */

import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { PasswordChecklist } from '@/components/password-checklist';
import { AuthShell } from '@/components/auth-shell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { CodeField } from '@/components/ui/code-field';
import { ChartInk } from '@/constants/palette';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { EMAIL_CODE_LENGTH, useAuth } from '@/data/auth';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { MIN_PASSWORD_LENGTH, checkPassword, passwordAccepted } from '@/lib/password';

type Step = 'request' | 'verify' | 'choose';

/**
 * How long before a new code can be asked for. Supabase rate-limits this at
 * the server anyway; the countdown exists so the user is told to wait instead
 * of discovering it by being refused.
 */
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * "an 8-digit code", "a 6-digit code". Driven by how the digit is *said*, which
 * is why it can't just be derived from the first letter — only 8 is a vowel
 * sound among the lengths Supabase will issue.
 */
const CODE_LENGTH_ARTICLE = EMAIL_CODE_LENGTH === 8 ? 'an' : 'a';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useScheme();
  const { sendPasswordResetCode, verifyPasswordResetCode, completePasswordReset, cancelPasswordReset } =
    useAuth();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const trimmedEmail = email.trim();
  // Deliberately not a full RFC-5322 regex: the only job is to catch a missing
  // @ before spending a round trip. The server is the real validator.
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const passwordsMatch = password === confirmation;
  // The name isn't known here — this screen is reachable without a session — so
  // the personal-information rule only has the address to work with.
  const passwordRules = useMemo(
    () => checkPassword(password, { email: trimmedEmail }),
    [password, trimmedEmail]
  );
  const passwordAllowed = passwordAccepted(passwordRules);

  /** Ticks the resend cooldown down to zero, once per second. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  async function requestCode({ resend = false } = {}) {
    if (!emailLooksValid || busy) return;

    setBusy(true);
    clearMessages();
    try {
      const result = await sendPasswordResetCode(email);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStep('verify');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // On the first send the subtitle already says where the code went, so a
      // notice underneath would only repeat it. A resend has no such tell —
      // nothing on screen changes — so it gets one.
      if (resend) setNotice('A new code is on its way.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Guards against the code being submitted twice. The field auto-submits the
   * moment it fills up, and `busy` alone doesn't cover the gap between the
   * last keystroke and the state update landing.
   */
  const submitted = useRef<string | null>(null);

  const verifyCode = useCallback(
    async (candidate: string) => {
      if (busy || submitted.current === candidate) return;
      submitted.current = candidate;

      setBusy(true);
      clearMessages();
      try {
        const result = await verifyPasswordResetCode(email, candidate);
        if (result.error) {
          setError(result.error);
          // Clear the field rather than leave a rejected code sitting in it:
          // there is nothing to salvage by editing one digit, and an empty
          // field is what invites another attempt.
          setCode('');
          return;
        }
        // The user is signed in from here on. `passwordRecovery` is what keeps
        // the root navigator from noticing and swapping to the app underneath us.
        setStep('choose');
      } finally {
        setBusy(false);
      }
    },
    [busy, email, verifyPasswordResetCode]
  );

  /** Submit as soon as the last digit lands — there is nothing left to confirm. */
  useEffect(() => {
    if (step === 'verify' && code.length === EMAIL_CODE_LENGTH) {
      void verifyCode(code);
    }
  }, [code, step, verifyCode]);

  async function savePassword() {
    if (!passwordAllowed || !passwordsMatch || busy) return;

    setBusy(true);
    clearMessages();
    try {
      const result = await completePasswordReset(password);
      if (result.error) {
        setError(result.error);
        return;
      }
      // No navigation. Clearing the recovery flag re-registers the app screens
      // and the router lands on Home by itself.
    } finally {
      setBusy(false);
    }
  }

  /** Back out — one step at a time, discarding the session if there is one. */
  async function back() {
    if (step === 'choose') {
      await cancelPasswordReset();
      return;
    }
    if (step === 'verify') {
      setStep('request');
      setCode('');
      submitted.current = null;
      clearMessages();
      return;
    }
    router.back();
  }

  const inputStyle = [
    styles.input,
    { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
  ];

  const title =
    step === 'request'
      ? 'Reset your password'
      : step === 'verify'
        ? `${EMAIL_CODE_LENGTH}-digit code`
        : 'Choose a new password';

  const subtitle =
    step === 'request'
      ? `Enter your email and we will send you ${CODE_LENGTH_ARTICLE} ${EMAIL_CODE_LENGTH}-digit code.`
      : step === 'verify'
        ? // Phrased so it doesn't confirm whether the address has an account —
          // that would turn this screen into a way to enumerate users.
          `Code sent to ${trimmedEmail}, if an account exists for it.`
        : 'That worked. Set a new password to finish.';

  return (
    <AuthShell>
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag">
              <Pressable
                onPress={() => void back()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={Spacing.two}
                style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
                  size={22}
                  weight="medium"
                  tintColor={theme.text}
                />
              </Pressable>

              <View style={styles.header}>
                <ThemedText type="title">{title}</ThemedText>
                <ThemedText type="body" themeColor="textSecondary">
                  {subtitle}
                </ThemedText>
              </View>

              <View style={styles.form}>
                {step === 'request' && (
                  <View style={styles.field}>
                    <ThemedText type="label" themeColor="textSecondary">
                      Email
                    </ThemedText>
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
                      returnKeyType="go"
                      onSubmitEditing={() => void requestCode()}
                      style={inputStyle}
                      accessibilityLabel="Email"
                    />
                  </View>
                )}

                {step === 'verify' && (
                  <CodeField
                    value={code}
                    length={EMAIL_CODE_LENGTH}
                    onChange={(next) => {
                      setCode(next);
                      // Editing after a rejection re-arms the auto-submit.
                      if (next.length < EMAIL_CODE_LENGTH) submitted.current = null;
                    }}
                    editable={!busy}
                    autoFocus
                    accessibilityLabel={`${EMAIL_CODE_LENGTH} digit code`}
                  />
                )}

                {step === 'choose' && (
                  <>
                    <View style={styles.field}>
                      <ThemedText type="label" themeColor="textSecondary">
                        New password
                      </ThemedText>
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                        placeholderTextColor={theme.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        returnKeyType="next"
                        style={inputStyle}
                        accessibilityLabel="New password"
                      />
                    </View>

                    {/* Directly under the field it judges, and only once there is
                        something to judge. */}
                    {password.length > 0 && <PasswordChecklist rules={passwordRules} />}

                    <View style={styles.field}>
                      <ThemedText type="label" themeColor="textSecondary">
                        Confirm password
                      </ThemedText>
                      <TextInput
                        value={confirmation}
                        onChangeText={setConfirmation}
                        placeholder="Type it again"
                        placeholderTextColor={theme.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        returnKeyType="go"
                        onSubmitEditing={() => void savePassword()}
                        style={inputStyle}
                        accessibilityLabel="Confirm password"
                      />
                    </View>

                    {/* Only once they've started typing the confirmation —
                        flagging a mismatch against an empty field is nagging. */}
                    {confirmation.length > 0 && !passwordsMatch && (
                      <ThemedText type="label" style={{ color: ChartInk[scheme].critical }}>
                        Those two don&apos;t match yet.
                      </ThemedText>
                    )}
                  </>
                )}

                {error && (
                  <ThemedText
                    type="label"
                    style={{ color: ChartInk[scheme].critical }}
                    accessibilityRole="alert">
                    {error}
                  </ThemedText>
                )}

                {notice && !error && (
                  <ThemedText type="label" themeColor="accentInk" accessibilityRole="alert">
                    {notice}
                  </ThemedText>
                )}

                {step === 'request' && (
                  <Button
                    label="Send code"
                    onPress={() => void requestCode()}
                    disabled={!emailLooksValid || busy}
                    busy={busy}
                  />
                )}

                {/* No submit button on this step: the field auto-submits when the
                    last digit lands, so a button would only ever be pressed
                    after the work had already started. */}
                {step === 'verify' &&
                  (cooldown > 0 ? (
                    <ThemedText type="label" themeColor="textSecondary">
                      Resend code in {formatCountdown(cooldown)}
                    </ThemedText>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setCode('');
                        submitted.current = null;
                        void requestCode({ resend: true });
                      }}
                      disabled={busy}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
                      <ThemedText type="label" themeColor="accentInk">
                        Send a new code
                      </ThemedText>
                    </Pressable>
                  ))}

                {step === 'choose' && (
                  <Button
                    label="Save new password"
                    onPress={() => void savePassword()}
                    disabled={!passwordAllowed || !passwordsMatch || busy}
                    busy={busy}
                  />
                )}

                <Pressable
                  onPress={() => {
                    if (step === 'choose') {
                      void cancelPasswordReset();
                      return;
                    }
                    router.back();
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
                  <ThemedText type="label" themeColor="textSecondary">
                    {step === 'choose' ? 'Cancel and sign out' : 'Back to sign in'}
                  </ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ThemedView>
    </AuthShell>
  );
}

/** `95` → `01:35`. Matches how a countdown is written on every other timer. */
function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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
    padding: Spacing.four,
    gap: Spacing.four,
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
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
    // Otherwise the row stretches to the full form width and the tap target
    // reaches far past the end of the words.
    alignSelf: 'flex-start',
    paddingVertical: Spacing.one,
  },
  pressed: {
    opacity: 0.6,
  },
});
