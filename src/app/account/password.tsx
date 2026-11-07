/**
 * Change the password from inside the app.
 *
 * Distinct from `/reset-password`, which exists for someone who *can't* sign
 * in and therefore has to prove themselves by email. Here there is a session
 * already, so the first proof is the current password — typed rather than
 * emailed, which is faster.
 *
 * It is not the only proof, and it is not the one that counts. The project runs
 * with `security_update_password_require_reauthentication` on, so the server
 * decides whether the session is fresh enough to allow this. `changePassword`
 * signs in again before trying, which usually makes it fresh enough and nobody
 * sees the second step — but when the server asks for an emailed nonce, this
 * screen collects it. See the header of data/auth.tsx for why the typed
 * password alone was never sufficient.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { PasswordChecklist } from '@/components/password-checklist';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { CodeField } from '@/components/ui/code-field';
import { ChartInk } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { EMAIL_CODE_LENGTH, useAuth } from '@/data/auth';
import { useData } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import { MIN_PASSWORD_LENGTH, checkPassword, passwordAccepted } from '@/lib/password';

export default function ChangePasswordScreen() {
  const theme = useTheme();
  const scheme = useScheme();
  const dismiss = useDismiss();
  const { changePassword, user } = useAuth();
  const { profile } = useData();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Set once the server has refused the change and emailed a nonce. The three
   * password fields stay filled behind this — the retry sends the same new
   * password, so making anyone retype it would be asking them to prove they can
   * type it twice, again.
   */
  const [awaitingNonce, setAwaitingNonce] = useState(false);
  const [nonce, setNonce] = useState('');

  // The only screen that can check the new password against the old one and
  // against a name, because it is the only one with a session behind it.
  const passwordRules = useMemo(
    () =>
      checkPassword(next, {
        email: user?.email,
        name: profile?.fullName,
        currentPassword: current,
      }),
    [next, user?.email, profile?.fullName, current]
  );
  const allowed = passwordAccepted(passwordRules);
  const matches = next === confirmation;
  const canSubmit = current.length > 0 && allowed && matches && !busy;

  /**
   * Guards against the nonce being submitted twice — the code field auto-submits
   * the moment it fills, and `busy` alone doesn't cover the gap between the last
   * keystroke and the state update landing. Same pattern as account/email.tsx.
   */
  const submitted = useRef<string | null>(null);

  const submit = useCallback(
    async (withNonce?: string) => {
      // The nonce retry runs from an effect, where `canSubmit` has already been
      // true once and the fields are behind a code step nobody can edit.
      if (withNonce === undefined && !canSubmit) return;
      if (busy) return;

      setBusy(true);
      setError(null);
      try {
        const result = await changePassword(current, next, withNonce);

        if (result.error) {
          setError(result.error);
          // A rejected nonce clears the field rather than leaving it there:
          // there is nothing to salvage by editing one digit, and an empty
          // field is what invites another attempt.
          if (withNonce !== undefined) {
            setNonce('');
            submitted.current = null;
          }
          return;
        }

        if (result.needsNonce) {
          setAwaitingNonce(true);
          return;
        }

        // Leaving rather than showing a "done" line. The session survives the
        // change, so there is nothing left to do on this screen, and a success
        // message above three now-meaningless fields invites a second attempt.
        dismiss();
      } finally {
        setBusy(false);
      }
    },
    [busy, canSubmit, changePassword, current, next, dismiss]
  );

  /** Submit as soon as the last digit lands — there is nothing left to confirm. */
  useEffect(() => {
    if (!awaitingNonce || nonce.length !== EMAIL_CODE_LENGTH) return;
    if (submitted.current === nonce) return;
    submitted.current = nonce;
    void submit(nonce);
  }, [awaitingNonce, nonce, submit]);

  const inputStyle = [styles.input, { color: theme.text }];
  const wrapStyle = [styles.inputWrap, { backgroundColor: theme.backgroundElement }];

  // The nonce step replaces the form rather than appearing under it. Leaving
  // three filled password fields on screen next to a code field invites editing
  // one of them, which would silently disagree with the change the emailed nonce
  // was issued for.
  if (awaitingNonce) {
    return (
      <ThemedView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <ThemedText type="label" themeColor="textSecondary">
              Code sent to
            </ThemedText>
            <ThemedText type="heading">{user?.email ?? 'your inbox'}</ThemedText>
            <ThemedText type="label" themeColor="textSecondary">
              One more step — type the {EMAIL_CODE_LENGTH}-digit code to confirm the change. Your
              password hasn&apos;t changed yet.
            </ThemedText>
          </View>

          <CodeField
            value={nonce}
            length={EMAIL_CODE_LENGTH}
            onChange={(entered) => {
              setNonce(entered);
              // Editing after a rejection re-arms the auto-submit.
              if (entered.length < EMAIL_CODE_LENGTH) submitted.current = null;
            }}
            editable={!busy}
            autoFocus
            accessibilityLabel={`${EMAIL_CODE_LENGTH} digit code`}
          />

          {error && (
            <ThemedText
              type="label"
              style={{ color: ChartInk[scheme].critical }}
              accessibilityRole="alert">
              {error}
            </ThemedText>
          )}

          {/* No submit button: the field submits itself once the last digit
              lands, so a button could only ever be pressed after the work had
              already started. */}
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setAwaitingNonce(false);
              setNonce('');
              submitted.current = null;
              setError(null);
            }}
            disabled={busy}
          />
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Current password">
          <View style={wrapStyle}>
            <TextInput
              value={current}
              onChangeText={setCurrent}
              placeholder="The one you use now"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="next"
              style={inputStyle}
              accessibilityLabel="Current password"
            />
          </View>
        </Field>

        <Field label="New password">
          <View style={wrapStyle}>
            <TextInput
              value={next}
              onChangeText={setNext}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              placeholderTextColor={theme.textSecondary}
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
        </Field>

        {/* Directly under the field it judges, and only once there is something
            to judge. */}
        {next.length > 0 && <PasswordChecklist rules={passwordRules} />}

        <Field label="Confirm new password">
          <View style={wrapStyle}>
            <TextInput
              value={confirmation}
              onChangeText={setConfirmation}
              placeholder="Type it again"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              style={inputStyle}
              accessibilityLabel="Confirm new password"
            />
          </View>
        </Field>

        {/* Only once they've started typing the confirmation — flagging a
            mismatch against an empty field is nagging. */}
        {confirmation.length > 0 && !matches && (
          <ThemedText type="label" style={{ color: ChartInk[scheme].critical }}>
            Those two don&apos;t match yet.
          </ThemedText>
        )}

        {error && (
          <ThemedText
            type="label"
            style={{ color: ChartInk[scheme].critical }}
            accessibilityRole="alert">
            {error}
          </ThemedText>
        )}

        <Button
          label="Change password"
          onPress={() => void submit()}
          disabled={!canSubmit}
          busy={busy}
        />

        <ThemedText type="label" themeColor="textMuted">
          You stay signed in on this device. Other devices keep working until their session
          expires.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
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
