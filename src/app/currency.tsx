/**
 * Currency picker.
 *
 * A modal with a search field rather than the row of chips this replaced. Five
 * currencies fit in a card; the full CLDR list is 162, and a wrapped chip pile
 * that long is not something anyone can find their own currency in. Search is
 * the whole interaction — type "yen", "kr", "AED".
 *
 * The list is flat and unsorted beyond its natural code order. A "popular
 * currencies" section at the top was the obvious alternative and is deliberately
 * not here: whose popular? Anyone whose currency didn't make the cut pays for it
 * by scrolling past six that aren't theirs, every time.
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCIES, type Currency } from '@/constants/currencies';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/money';

/** What a currency looks like in use, so the choice is made on the real thing. */
const SAMPLE_MINOR = 123456;

export default function CurrencyScreen() {
  const theme = useTheme();
  const dismiss = useDismiss();
  const { preferences, mutate } = useData();

  const [search, setSearch] = useState('');

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return CURRENCIES;

    // Code first, then name, so typing "gb" puts GBP above "Gambian Dalasi".
    const byCode: Currency[] = [];
    const byName: Currency[] = [];
    for (const currency of CURRENCIES) {
      if (currency.code.toLowerCase().startsWith(needle)) byCode.push(currency);
      else if (currency.name.toLowerCase().includes(needle)) byName.push(currency);
    }
    return [...byCode, ...byName];
  }, [search]);

  async function choose(code: string) {
    // Dismiss first. The write is a round trip, and leaving the sheet up until
    // it lands makes a tap on your own currency feel like it didn't register.
    dismiss();
    await mutate((repo) => repo.setPreferences({ currencyCode: code }));
  }

  return (
    <ThemedView style={styles.root}>
      <View style={styles.searchWrap}>
        <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search currencies"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
            accessibilityLabel="Search currencies"
          />
        </View>
      </View>

      <FlatList
        data={matches}
        keyExtractor={(currency) => currency.code}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <ThemedText type="body" themeColor="textSecondary" style={styles.empty}>
            No currency matches “{search.trim()}”.
          </ThemedText>
        }
        renderItem={({ item }) => (
          <Row
            currency={item}
            selected={item.code === preferences.currencyCode}
            onPress={() => void choose(item.code)}
          />
        )}
      />
    </ThemedView>
  );
}

function Row({
  currency,
  selected,
  onPress,
}: {
  currency: Currency;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${currency.name}, ${currency.code}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? theme.accentWash : theme.backgroundElement,
          borderColor: selected ? theme.accent : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      <View style={styles.rowText}>
        <ThemedText type="label" themeColor={selected ? 'accentInk' : 'text'}>
          {currency.code}
        </ThemedText>
        <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
          {currency.name}
        </ThemedText>
      </View>
      <ThemedText type="label" themeColor="textSecondary" tabular>
        {formatMoney(SAMPLE_MINOR, currency.code)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  searchWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  inputWrap: {
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 14,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  empty: {
    paddingVertical: Spacing.five,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
