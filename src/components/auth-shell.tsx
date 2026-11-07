/**
 * The signed-out screens' frame on a wide window.
 *
 * On a phone the form *is* the screen. On a desktop the same form floats in a
 * 1400px void, so the wide layout gives the other half to the brand: a panel
 * of signal orange with the wordmark set the way the app sets money — wide,
 * heavy, black ink on orange, like a sign. It is the first thing anyone sees
 * of the app, and the one place the identity is allowed to be the whole
 * picture.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, Type, Wide } from '@/constants/theme';
import { useIsWide } from '@/hooks/use-is-wide';
import { useTheme } from '@/hooks/use-theme';

export function AuthShell({ children }: { children: ReactNode }) {
  const wide = useIsWide();
  const theme = useTheme();

  if (!wide) return <>{children}</>;

  return (
    <View style={[styles.row, { backgroundColor: theme.background }]}>
      <View style={[styles.brand, { backgroundColor: theme.accent }]}>
        <ThemedText style={[styles.wordmark, { color: theme.onAccent }]} accessibilityRole="header">
          budgetit
        </ThemedText>
        <ThemedText type="heading" style={[styles.line, { color: theme.onAccent }]}>
          Log what you spend. See what&apos;s left.
        </ThemedText>
      </View>
      <View style={styles.form}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  brand: {
    width: '44%',
    maxWidth: 640,
    justifyContent: 'flex-end',
    padding: Spacing.six - Spacing.three,
    gap: Spacing.three,
  },
  wordmark: {
    ...Type.display,
    ...Wide,
    fontSize: 96,
    lineHeight: 96,
    fontWeight: '800',
    letterSpacing: -4,
  },
  line: {
    maxWidth: 360,
    fontWeight: '500',
  },
  form: {
    flex: 1,
  },
});
