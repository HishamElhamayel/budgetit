import { StyleSheet, Text, type TextProps } from 'react-native';

import { ThemeColor, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: keyof typeof Type;
  themeColor?: ThemeColor;
  /**
   * Aligns digits into columns. Off by default: tabular figures give every
   * digit the width of a zero, which reads loose on a large standalone number
   * and is only worth it where numbers stack vertically.
   */
  tabular?: boolean;
};

/**
 * Hierarchy here comes from size and *ink colour*, not weight — one weight per
 * size, and a step down to `textSecondary` where something should recede. It
 * keeps the type from turning into a pile of near-identical bolds. The two
 * exceptions are `display` and `figure`, which are money: those are set wide
 * and heavy on purpose, as the one loud thing on any screen.
 */
export function ThemedText({
  style,
  type = 'body',
  themeColor,
  tabular = false,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[{ color: theme[themeColor ?? 'text'] }, styles[type], tabular && styles.tabular, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  display: Type.display,
  figure: Type.figure,
  title: Type.title,
  heading: Type.heading,
  body: Type.body,
  label: Type.label,
  micro: Type.micro,
  tabular: { fontVariant: ['tabular-nums'] },
});
