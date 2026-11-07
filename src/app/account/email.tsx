/**
 * Change the address the account signs in with: prove who you are and say where
 * you're going, then confirm from both inboxes.
 *
 * Codes, not links — the same choice `/reset-password` makes, for the reasons
 * in data/auth.tsx plus one specific to this flow: a link has to land the user
 * on a page somebody has to host and keep alive, whose entire content is "you
 * can go back to the app now". A code the user retypes needs no such page, no
 * redirect allowlist, and no Site URL that is correct in production and wrong
 * on every developer's machine.
 *
 * **Two codes, not one**, because the project runs with secure email change on.
 * That is not a preference — it is the only thing standing between a stolen
 * access token and an account walked off to somebody else's inbox, since the
 * password prompt below is enforced by this file and therefore by nothing at
 * all as far as an attacker is concerned. The header of data/auth.tsx has the
 * long version.
 *
 * The cost is the one worth designing against: two 8-digit codes arriving at
 * once, and a "that code is wrong" if they are entered the wrong way round. So
 * the two are asked for one at a time, each step naming the inbox it means, and
 * the copy never says "the code" without saying which. The steps are also
 * skippable in either direction, because a change resumed after the app was
 * closed has no way to know which half was already done.
 *
 * One screen rather than three routes, because every step needs the address
 * typed in the first — `verifyOtp` looks each token up against its own address
 * — and threading that through navigation params would put a user's email in
 * the URL bar on web.
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
 * Which half of the change is being confirmed.
 *
 * `current` is the address being left, `new` the one being moved to. Each has
 * its own token, valid only against its own address, so this decides both which
 * inbox the copy names and which address `verifyEmailChange` is handed.
 */
type Side = 'current' | 'new';

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
  // Starts on the address being left. Either order works — the server holds both
  // tokens until both are spent — but confirming from the old inbox first is the
  // half that proves the account is still yours, which is the one worth asking
  // for while the user's attention is on why they were asked at all.
  const [side, setSide] = useState<Side>('current');
  const [nextEmail, setNextEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const currentEmail = user?.email ?? 'your account';
  /**
   * Guards against the code being submitted twice. The field auto-submits the
   * moment it fills up, and `busy` alone doesn't cover the gap between the last
   * keystroke and the state update landing.
   *
   * Declared up here, above every function that touches it, rather than next to
   * the callback that reads it. The compiler's immutability rule tracks a ref
   * from its declaration, and a write appearing earlier in the file than the
   * `useRef` — `requestCode` clears it when the codes go out — makes every other
   * write an error.
   */
  const submitted = useRef<string | null>(null);

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
      setSide('current');
      setCode('');
      submitted.current = null;
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // The password has done its job. Holding it in state for the rest of the
      // flow would be keeping a credential around for no further use.
      setPassword('');
      setNotice(
        resend
          ? 'Two new codes are on their way — one to each address.'
          : `Two codes are on their way: one to ${currentEmail}, one to ${trimmed}.`
      );
    } finally {
      setBusy(false);
    }
  }

  const verifyCode = useCallback(
    async (candidate: string) => {
      if (busy || submitted.current === candidate) return;
      submitted.current = candidate;

      setBusy(true);
      clearMessages();
      try {
        // Each token is only valid against the address it was mailed to, so the
        // side decides which address goes in — not which one the user is moving
        // to. Handing over the wrong one fails as "token not found".
        const address = side === 'current' ? currentEmail : trimmed;
        const result = await verifyEmailChange(address, candidate);

        if (result.error) {
          setError(result.error);
          // Clear the field rather than leave a rejected code in it: there is
          // nothing to salvage by editing one digit, and an empty field is what
          // invites another attempt. The field's own `onChange` re-arms the
          // guard on the next keystroke — doing it here instead would be a write
          // to a ref this callback closes over, which the compiler rejects.
          setCode('');
          return;
        }

        if (side === 'current') {
          // Half done. The account still signs in with the old address until
          // the second code lands, which is why this advances rather than
          // dismissing — and why the copy on the next step says so.
          setSide('new');
          setCode('');
          setNotice(`Confirmed from ${currentEmail}. One to go.`);
          return;
        }

        // Both sides spent: the session now carries the new address, so the
        // account screen behind this one is already correct.
        dismiss();
      } finally {
        setBusy(false);
      }
    },
    [busy, side, currentEmail, trimmed, verifyEmailChange, dismiss]
  );

  /** Submit as soon as the last digit lands — there is nothing left to confirm. */
  useEffect(() => {
    if (step === 'verify' && code.length === EMAIL_CODE_LENGTH) {
      void verifyCode(code);
    }
  }, [code, step, verifyCode]);

  /** Back out of the code steps to fix a mistyped address. */
  function back() {
    setStep('request');
    setSide('current');
    setCode('');
    submitted.current = null;
    clearMessages();
  }

  /** Jump to the other half, for a change resumed with one side already done. */
  function otherSide() {
    setSide((current) => (current === 'current' ? 'new' : 'current'));
    setCode('');
    submitted.current = null;
    clearMessages();
  }

  const inputStyle = [styles.input, { color: theme.text }];
  const wrapStyle = [styles.inputWrap, { backgroundColor: theme.backgroundElement }];

  // The inbox this step is asking about — named in the heading rather than left
  // to "the code", because at this point there are two of them in flight.
  const awaitingFrom = side === 'current' ? currentEmail : trimmed;

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ThemedText type="label" themeColor="textSecondary">
            {step === 'request'
              ? 'Signing in with'
              : side === 'current'
                ? 'Step 1 of 2 — code sent to'
                : 'Step 2 of 2 — code sent to'}
          </ThemedText>
          <ThemedText type="heading">{step === 'request' ? currentEmail : awaitingFrom}</ThemedText>
          {step === 'verify' && (
            <ThemedText type="label" themeColor="textSecondary">
              {side === 'current'
                ? `Confirming from the address you're leaving. Type the ${EMAIL_CODE_LENGTH}-digit code sent to ${currentEmail} — not the one sent to ${trimmed}.`
                : `Nearly there. Type the ${EMAIL_CODE_LENGTH}-digit code sent to ${trimmed}. You'll keep signing in with ${currentEmail} until you do.`}
            </ThemedText>
          )}
        </View>

        {/* Codes were sent earlier and never used — the app was closed, or the
            mail took a minute to arrive. Without this the only way back into
            that change is to request more, which burns two more emails and
            invalidates the codes already sitting in their inboxes.

            Resumes at step one. Which half was already confirmed is not
            something the client can read — `pendingEmail` says a change is in
            flight, not how far along it is — so the step is offered rather than
            assumed, and "already did this one" skips it. */}
        {step === 'request' && pendingEmail && (
          <Button
            label={`Finish the change to ${pendingEmail}`}
            variant="secondary"
            onPress={() => {
              setNextEmail(pendingEmail);
              setSide('current');
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
            label="Send codes"
            onPress={() => void requestCode()}
            disabled={!canRequest}
            busy={busy}
          />
        ) : (
          // No submit button here: the field auto-submits when the last digit
          // lands, so a button would only ever be pressed after the work had
          // already started.
          <>
            {/* The escape hatch for a resumed change, and for anyone who opened
                the wrong email first. Both tokens stay live until each is spent,
                so moving between the two halves costs nothing. */}
            <Button
              label={
                side === 'current'
                  ? `Already confirmed from ${currentEmail}`
                  : `Enter the code from ${currentEmail} instead`
              }
              variant="secondary"
              onPress={otherSide}
              disabled={busy}
            />

            {cooldown > 0 ? (
              <ThemedText type="label" themeColor="textSecondary">
                Resend codes in {formatCountdown(cooldown)}
              </ThemedText>
            ) : (
              <Button
                label="Send new codes"
                variant="secondary"
                onPress={() => {
                  // Re-requesting needs the password again, which was dropped
                  // on the way into this step, so this goes back rather than
                  // silently failing the re-auth.
                  back();
                  setNotice('Enter your password again to send new codes.');
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
