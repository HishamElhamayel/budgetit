/**
 * The "what do you want to add?" sheet behind the `+` on Home.
 *
 * Exists because three creatable things — income, budget, category — is one too
 * many to hang off a single icon without asking. Each row states what the thing
 * *is*, not just its name, since budget-vs-category is exactly the distinction
 * new users get wrong.
 */

import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChartInk, slotColor } from '@/constants/palette';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

export default function CreateChooserScreen() {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useScheme();

  const options = [
    {
      href: '/income/new' as const,
      title: 'Income',
      blurb: 'Money coming in — a paycheck, a refund, a side job.',
      color: ChartInk[scheme].good,
    },
    {
      href: '/budget/new' as const,
      title: 'Budget',
      blurb: 'A pot you spend from, with an optional limit per week or month.',
      color: slotColor(0, scheme),
    },
    {
      href: '/category/new' as const,
      title: 'Category',
      blurb: 'What a purchase was for. Shared across every budget.',
      color: slotColor(1, scheme),
    },
  ];

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {options.map((option) => (
          <Pressable
            key={option.href}
            accessibilityRole="button"
            onPress={() => router.replace(option.href)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <View style={[styles.dot, { backgroundColor: option.color }]} />
            <View style={styles.text}>
              <ThemedText type="label">{option.title}</ThemedText>
              <ThemedText type="label" themeColor="textSecondary">
                {option.blurb}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 5,
  },
  text: {
    flex: 1,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.6,
  },
});
