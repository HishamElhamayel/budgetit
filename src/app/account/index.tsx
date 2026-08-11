/**
 * Account — the profile, and the way in to the two credential changes.
 *
 * Split three ways rather than kept as one long form, because the three things
 * behave differently. Name and country are a plain edit: type, save, done.
 * Email is a request that finishes in a mail client, minutes later, possibly on
 * another device. Password is a swap that has to be confirmed twice. Putting
 * all three on one screen would mean one Save button whose meaning changed
 * depending on which field had been touched, and three different kinds of
 * "it worked" competing for the same line of text.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { CountryField } from '@/components/country-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ChartInk } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/data/auth';
import { useData } from '@/data/store';
import type { Profile } from '@/db/types';
import { useDismiss } from '@/hooks/use-dismiss';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

export default function AccountScreen() {
  const { profile } = useData();

  // The form is a child taking a non-null profile, so its initial state can
  // come straight from `useState` with no effect syncing it afterwards. The
  // `key` is what handles a profile that changes underneath — a save, or the
  // same account edited on another device — by remounting rather than by
  // reconciling a draft against a value that moved.
  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {profile ? (
          <ProfileForm
            key={`${profile.fullName ?? ''}|${profile.countryCode ?? ''}`}
            profile={profile}
          />
        ) : (
          // Only seen if this route is deep-linked into before the first load
          // has settled. Every path through the app opens it from a tab that
          // already has the data.
          <ThemedText type="label" themeColor="textSecondary">
            Loading your details…
          </ThemedText>
        )}

        <Credentials />

        {profile && (
          <ThemedText type="label" style={styles.footer} themeColor="textMuted">
            Member since {formatJoined(profile.createdAt)}
          </ThemedText>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const theme = useTheme();
  const scheme = useScheme();
  const dismiss = useDismiss();
  const { mutate } = useData();

  const [fullName, setFullName] = useState(profile.fullName ?? '');
  const [countryCode, setCountryCode] = useState<string | null>(profile.countryCode);
  const [busy, setBusy] = useState(false);

  const trimmedName = fullName.trim();
  const storedName = profile.fullName ?? '';
  // Compared against the stored value rather than tracked with an `onChange`
  // flag, so typing a character and deleting it again leaves the button off.
  const changed = trimmedName !== storedName || countryCode !== profile.countryCode;
  /**
   * The one edit worth refusing: emptying a name that was set.
   *
   * Deliberately not "the name must be non-empty". Profiles can arrive here
   * already nameless — accounts made before the profiles migration, whose
   * backfill had no `full_name` in the metadata to recover, and the repair
   * insert in `getProfile`. Gating the button on a non-empty name held those
   * accounts hostage: changing the country did nothing, because a *different*
   * untouched field was empty, and the disabled button said nothing about why.
   */
  const nameCleared = trimmedName.length === 0 && storedName.length > 0;
  const canSave = changed && !nameCleared && !busy;

  async function save() {
    if (!canSave) return;

    setBusy(true);
    try {
      await mutate((repo) => repo.updateProfile({ fullName: trimmedName, countryCode }));
      dismiss();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field label="Name">
        <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="What should we call you?"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="name"
            textContentType="name"
            maxLength={80}
            style={[styles.input, { color: theme.text }]}
            accessibilityLabel="Name"
          />
        </View>

        {/* Only when they have actually emptied a name that was there. A
            disabled Save with nothing explaining it is what sent someone
            looking for the bug in the country picker. */}
        {nameCleared && (
          <ThemedText type="label" style={{ color: ChartInk[scheme].critical }}>
            Your name can&apos;t be left empty.
          </ThemedText>
        )}
      </Field>

      <Field label="Country" hint="Only used to pick sensible defaults for you.">
        <CountryField
          value={countryCode}
          onChange={setCountryCode}
          placeholder="Not set"
          // Flattened to match the borderless fields on this screen. The field
          // carries its own border for the sign-up form, which has them.
          style={[styles.inputWrap, styles.countryField, { backgroundColor: theme.backgroundElement }]}
        />
      </Field>

      <Button label="Save changes" onPress={() => void save()} disabled={!canSave} busy={busy} />
    </>
  );
}

/** Email and password: two rows that go somewhere, not two fields. */
function Credentials() {
  const router = useRouter();
  const { user, pendingEmail } = useAuth();

  return (
    <Field label="Sign-in">
      <LinkRow
        label="Email"
        value={user?.email ?? 'Unknown'}
        // Surfaced here as well as on the email screen, because this is the
        // list someone scans to find out whether the change they started
        // yesterday ever went through. Worded as an instruction rather than a
        // status, since the row it sits on is the way to finish the job.
        note={pendingEmail ? `Tap to enter the code sent to ${pendingEmail}` : undefined}
        onPress={() => router.push('/account/email')}
      />
      <LinkRow
        label="Password"
        value="••••••••"
        onPress={() => router.push('/account/password')}
      />
    </Field>
  );
}

function LinkRow({
  label,
  value,
  note,
  onPress,
}: {
  label: string;
  value: string;
  note?: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      style={({ pressed }) => [
        styles.linkRow,
        { backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <View style={styles.linkRowText}>
        <ThemedText type="label">{label}</ThemedText>
        <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
          {value}
        </ThemedText>
        {note && (
          <ThemedText type="label" themeColor="accentInk">
            {note}
          </ThemedText>
        )}
      </View>
      <ThemedText type="body" themeColor="textSecondary">
        ›
      </ThemedText>
    </Pressable>
  );
}

/**
 * "August 2026". Deliberately not `formatMonthLabel`, which drops the year for
 * the current one — that reads as an unfinished sentence after "Member since".
 */
function formatJoined(isoInstant: string): string {
  return new Date(isoInstant).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
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
  countryField: {
    borderWidth: 0,
    paddingVertical: 14,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  linkRowText: {
    flex: 1,
    gap: Spacing.one,
  },
  footer: {
    textAlign: 'center',
    paddingTop: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
