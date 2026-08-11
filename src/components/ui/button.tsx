import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChartInk } from '@/constants/palette';
import { Radius, Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'danger';

/**
 * One button, three jobs.
 *
 * `primary` is the only thing on a screen allowed to wear the accent fill —
 * that's what makes the accent mean "this is the action". Screens with two
 * equally-weighted choices get one primary and one secondary, never two
 * primaries.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const inactive = disabled || busy;

  const surface =
    variant === 'primary'
      ? theme.accent
      : variant === 'secondary'
        ? theme.backgroundElement
        : 'transparent';

  const ink =
    variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? ChartInk[scheme].critical : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: surface,
          borderColor: variant === 'secondary' ? theme.border : 'transparent',
          opacity: inactive ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <ThemedText type="body" style={[styles.label, { color: ink }]}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  label: {
    fontWeight: '600',
  },
});
