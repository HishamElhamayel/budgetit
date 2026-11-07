import { StyleSheet, View, type ViewProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's one surface primitive.
 *
 * Separation comes from a hairline border and nothing else. On the grey paper
 * ground a white card already reads as raised; a drop shadow under every card
 * would make a dashboard of them look like a pile of floating slabs.
 *
 * Chart palettes are validated against this card's colour, not the page
 * ground, because that's what the marks actually sit on.
 */
export function Card({
  title,
  action,
  style,
  children,
  ...rest
}: ViewProps & { title?: string; action?: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        style,
      ]}
      {...rest}>
      {(title || action) && (
        <View style={styles.header}>
          {title ? <ThemedText type="heading">{title}</ThemedText> : <View />}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * A small grey line above a section — names what follows without competing
 * with it, so the heading stays the loudest thing on screen.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <ThemedText type="label" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
});
