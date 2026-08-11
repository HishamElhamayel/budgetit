import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChartInk } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';
import type { PasswordRule } from '@/lib/password';

/**
 * The password rules, ticking off as they are met.
 *
 * Shown from the first keystroke and never hidden while the field is in play.
 * The alternative — a disabled button and an error after submitting — makes the
 * user guess which of several rules they missed, and guessing at a password
 * field is what sends people to "password" plus whatever gets them past it.
 *
 * Unmet rules are deliberately not red. Nothing has gone wrong yet; they are
 * halfway through typing. Red arrives only via the screen's own error line,
 * once they have actually tried something the server refused.
 */
export function PasswordChecklist({ rules }: { rules: readonly PasswordRule[] }) {
  const theme = useTheme();
  const scheme = useScheme();

  return (
    <View
      style={styles.list}
      // Read as one block. Announcing four separate rows means swiping through
      // the checklist to hear what is left, in a field that can't be reviewed
      // by reading it back.
      accessible
      accessibilityLabel={`Password requirements. ${rules
        .map((rule) => `${rule.label}: ${rule.met ? 'met' : 'not met'}`)
        .join('. ')}`}>
      {rules.map((rule) => (
        <View key={rule.id} style={styles.row}>
          <SymbolView
            name={
              rule.met
                ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                : { ios: 'circle', android: 'circle', web: 'circle' }
            }
            size={15}
            weight="medium"
            tintColor={rule.met ? ChartInk[scheme].good : theme.textMuted}
          />
          <ThemedText type="label" themeColor={rule.met ? 'textSecondary' : 'textMuted'}>
            {rule.label}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
