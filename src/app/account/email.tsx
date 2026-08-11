/**
 * Change the address the account signs in with, in two steps on one screen:
 * prove who you are and say where you're going, then type the code that lands
 * in the new inbox.
 *
 * Codes, not links — the same choice `/reset-password` makes, for the reasons
 * in data/auth.tsx plus one specific to this flow: a link has to land the user
 * on a page somebody has to host and keep alive, whose entire content is "you
 * can go back to the app now". A code the user retypes needs no such page, no
 * redirect allowlist, and no Site URL that is correct in production and wrong
 * on every developer's machine.
 *
 * One screen rather than two routes, because step two needs the address typed
 * in step one — `verifyOtp` looks the token up against it — and threading that
 * through navigation params would put a user's email in the URL bar on web.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { CodeField } from '@/components/ui/code-field';
import { ChartInk } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { EMAIL_CODE_LENGTH, useAuth } from '@/data/auth';
import { useDismiss } from '@/hooks/use-dismiss';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

type Step = 'request' | 'verify';

/**
 * How long before a new code can be asked for. The server rate-limits this
 * anyway; the countdown exists so the user is told to wait rather than
 * discovering it by being refused.
 */
const RESEND_COOLDOWN_SECONDS = 30;

export default function ChangeEmailScreen() {
  const theme = useTheme();
  const scheme = useScheme();
  const dismiss = useDismiss();
  const { user, pendingEmail, changeEmail, verifyEmailChange } = useAuth();

  const [step, setStep] = useState<Step>('request');
  const [nextEmail, setNextEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const currentEmail = user?.email ?? 'your account';
  const trimmed = nextEmail.trim();
  // The same deliberately-loose check the sign-in form uses: catch a missing @
  // before spending a round trip, and let the server be the real validator.
  const looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const canRequest = looksValid && password.length > 0 && !busy;

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
    if (!canRequest) return;

    setBusy(true);
    clearMessages();
    try {
      const result = await changeEmail(trimmed, password);
      if (result.error) {
        setError(result.error);
        return;
      }

      setStep('verify');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // The password has done its job. Holding it in state for the rest of the
      // flow would be keeping a credential around for no further use.
      setPassword('');
      if (resend) setNotice('A new code is on its way.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Guards against the code being submitted twice. The field auto-submits the
   * moment it fills up, and `busy` alone doesn't cover the gap between the last
   * keystroke and the state update landing.
   */
  const submitted = useRef<string | null>(null);

  const verifyCode = useCallback(
    async (candidate: string) => {
      if (busy || submitted.current === candidate) return;
      submitted.current = candidate;

      setBusy(true);
      clearMessages();
      try {
        const result = await verifyEmailChange(trimmed, candidate);
        if (result.error) {
          setError(result.error);
          // Clear the field rather than leave a rejected code in it: there is
          // nothing to salvage by editing one digit, and an empty field is what
          // invites another attempt.
          setCode('');
          return;
        }
        // The session now carries the new address, so the account screen behind
        // this one is already correct — there is nothing left here to look at.
        dismiss();
      } finally {
        setBusy(false);
      }
    },
    [busy, trimmed, verifyEmailChange, dismiss]
  );

  /** Submit as soon as the last digit lands — there is nothing left to confirm. */
  useEffect(() => {
    if (step === 'verify' && code.length === EMAIL_CODE_LENGTH) {
      void verifyCode(code);
    }
  }, [code, step, verifyCode]);

  /** Back out of the code step to fix a mistyped address. */
  function back() {
    setStep('request');
    setCode('');
    submitted.current = null;
    clearMessages();
  }

  const inputStyle = [styles.input, { color: theme.text }];
  const wrapStyle = [styles.inputWrap, { backgroundColor: theme.backgroundElement }];

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ThemedText type="label" themeColor="textSecondary">
            {step === 'request' ? 'Signing in with' : 'Code sent to'}
          </ThemedText>
          <ThemedText type="heading">{step === 'request' ? currentEmail : trimmed}</ThemedText>
          {step === 'verify' && (
            <ThemedText type="label" themeColor="textSecondary">
              Type the {EMAIL_CODE_LENGTH}-digit code to finish. You&apos;ll keep signing in with{' '}
              {currentEmail} until you do.
            </ThemedText>
          )}
        </View>

        {/* A code was sent earlier and never used — the app was closed, or the
            mail took a minute to arrive. Without this the only way back into
            that change is to request another one, which burns a second email
            and invalidates the code already sitting in their inbox. */}
        {step === 'request' && pendingEmail && (
          <Button
            label={`Enter the code sent to ${pendingEmail}`}
            variant="secondary"
            onPress={() => {
              setNextEmail(pendingEmail);
              setCode('');
              submitted.current = null;
              clearMessages();
              setStep('verify');
            }}
          />
        )}

        {step === 'request' && (
          <>
            <Field label="New email">
              <View style={wrapStyle}>
                <TextInput
                  value={nextEmail}
                  onChangeText={setNextEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  inputMode="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  style={inputStyle}
                  accessibilityLabel="New email"
                />
              </View>
            </Field>

            <Field
              label="Current password"
              hint="Asked for because an open app on an unlocked phone shouldn't be enough to move an account to a new address.">
              <View style={wrapStyle}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your password"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={() => void requestCode()}
                  style={inputStyle}
                  accessibilityLabel="Current password"
                />
              </View>
            </Field>
          </>
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

        {step === 'request' ? (
          <Button
            label="Send code"
            onPress={() => void requestCode()}
            disabled={!canRequest}
            busy={busy}
          />
        ) : (
          // No submit button here: the field auto-submits when the last digit
          // lands, so a button would only ever be pressed after the work had
          // already started.
          <>
            {cooldown > 0 ? (
              <ThemedText type="label" themeColor="textSecondary">
                Resend code in {formatCountdown(cooldown)}
              </ThemedText>
            ) : (
              <Button
                label="Send a new code"
                variant="secondary"
                onPress={() => {
                  // Re-requesting needs the password again, which was dropped
                  // on the way into this step, so this goes back rather than
                  // silently failing the re-auth.
                  back();
                  setNotice('Enter your password again to send a new code.');
                }}
                disabled={busy}
              />
            )}
            <Button label="Use a different address" variant="secondary" onPress={back} disabled={busy} />
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

/** `95` → `01:35`. Matches how a countdown is written on every other timer. */
function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
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
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.one,
  },
  field: {
    gap: Spacing.two,
  },
  inputWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 14,
  },
});
