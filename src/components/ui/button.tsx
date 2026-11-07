import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChartInk } from '@/constants/palette';
import { Radius, Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'danger';

/** Pressable's state on web, where react-native-web adds hover and focus. */
type PressableState = { pressed: boolean; hovered?: boolean; focused?: boolean };

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

  // A disabled primary goes grey rather than fading. Dark ink on an orange at
  // 40% opacity is a muddy brown that still reads as "press me"; a flat
  // neutral says the button exists and isn't ready. Busy keeps its orange —
  // the press was accepted and the spinner is the answer.
  const dormant = disabled && !busy;

  const surface = dormant
    ? variant === 'danger'
      ? 'transparent'
      : theme.backgroundSelected
    : variant === 'primary'
      ? theme.accent
      : variant === 'secondary'
        ? theme.backgroundElement
        : 'transparent';

  const ink = dormant
    ? theme.textMuted
    : variant === 'primary'
      ? theme.onAccent
      : variant === 'danger'
        ? ChartInk[scheme].critical
        : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed, hovered, focused }: PressableState) => [
        styles.button,
        {
          backgroundColor: surface,
          borderColor: variant === 'secondary' ? theme.border : 'transparent',
          opacity: inactive ? 1 : pressed ? 0.85 : hovered ? 0.92 : 1,
        },
        focused && { outlineColor: theme.text, ...styles.focusRing },
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
  focusRing: {
    outlineStyle: 'solid',
    outlineWidth: 2,
    outlineOffset: 2,
  } as object,
});
