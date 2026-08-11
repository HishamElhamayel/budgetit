import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's selection primitive. Budgets, categories and dates are all chips so
 * the fast path is always "tap a visible option" rather than "open a picker" —
 * a picker costs a tap to open, a tap to choose and a tap to dismiss.
 *
 * Selection is marked with the accent wash and an accent border, not with the
 * entity's own colour. The leading dot already carries identity; tinting the
 * whole chip by category would make "selected" and "is green" the same signal.
 */
export function Chip({
  label,
  selected = false,
  color,
  onPress,
  style,
}: {
  label: string;
  selected?: boolean;
  /** Entity colour, shown as a leading dot. */
  color?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.accentWash : theme.backgroundElement,
          borderColor: selected ? theme.accent : theme.border,
        },
        pressed && styles.pressed,
        style,
      ]}>
      {color && <View style={[styles.dot, { backgroundColor: color }]} />}
      <ThemedText type="label" themeColor={selected ? 'accentInk' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.chip,
    borderWidth: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
