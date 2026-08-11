/**
 * Change the password from inside the app.
 *
 * Distinct from `/reset-password`, which exists for someone who *can't* sign
 * in and therefore has to prove themselves by email. Here there is a session
 * already, so the proof is the current password — typed rather than emailed,
 * which is both faster and the only thing that makes the session itself
 * insufficient. See the note at the top of data/auth.tsx for why that matters.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { PasswordChecklist } from '@/components/password-checklist';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ChartInk } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/data/auth';
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

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const result = await changePassword(current, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      // Leaving rather than showing a "done" line. The session survives the
      // change, so there is nothing left to do on this screen, and a success
      // message above three now-meaningless fields invites a second attempt.
      dismiss();
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = [styles.input, { color: theme.text }];
  const wrapStyle = [styles.inputWrap, { backgroundColor: theme.backgroundElement }];

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
