/**
 * A country field, and the searchable sheet behind it.
 *
 * Deliberately a component rather than a route, which is what the currency
 * picker is. The reason is the navigator: `/currency` sits inside
 * `Stack.Protected guard={signedIn}`, and this field has to work on the
 * sign-up form, which by definition renders with no session. Registering the
 * same screen in both halves of the stack would give it two identities and two
 * ways to be dismissed; a self-contained `Modal` has neither problem and can be
 * dropped anywhere.
 *
 * 242 countries is far past what a picker can present as a list, so — as with
 * currencies — search is the whole interaction. There is no "popular countries"
 * section at the top for the same reason there is no popular-currencies one:
 * whoever didn't make the cut pays for it every single time.
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { COUNTRIES, findCountry, type Country } from '@/constants/countries';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The field itself: reads as a text input, behaves as a button.
 *
 * Styled to match the real `TextInput`s it sits between rather than as a chip
 * or a link, because in a column of fields anything that doesn't line up looks
 * like it belongs to a different form.
 */
export function CountryField({
  value,
  onChange,
  placeholder = 'Select a country',
  style,
  accessibilityLabel = 'Country',
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const country = findCountry(value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: country?.name ?? 'Not set' }}
        style={({ pressed }) => [
          styles.field,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          pressed && styles.pressed,
          style,
        ]}>
        <ThemedText
          type="body"
          // Muted when empty so it reads as a placeholder and not as an answer.
          style={[styles.fieldText, !country && { color: theme.textMuted }]}
          numberOfLines={1}>
          {country?.name ?? placeholder}
        </ThemedText>
        <ThemedText type="body" themeColor="textSecondary">
          ›
        </ThemedText>
      </Pressable>

      <CountrySheet
        visible={open}
        selectedCode={value}
        onSelect={(code) => {
          onChange(code);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function CountrySheet({
  visible,
  selectedCode,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedCode: string | null;
  onSelect: (code: string | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [search, setSearch] = useState('');

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return COUNTRIES;

    // Prefix matches first, so typing "ind" puts India above "West Indies"-ish
    // middles. The ISO code is matched too — someone who knows theirs is "AE"
    // should not have to remember how CLDR spells the name out.
    const leading: Country[] = [];
    const trailing: Country[] = [];
    for (const country of COUNTRIES) {
      const name = country.name.toLowerCase();
      if (name.startsWith(needle) || country.code.toLowerCase() === needle) leading.push(country);
      else if (name.includes(needle)) trailing.push(country);
    }
    return [...leading, ...trailing];
  }, [search]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // Android has no sheet presentation, so without this the modal renders on
      // a transparent ground and the screen underneath shows through the gaps.
      transparent={false}
      onRequestClose={onClose}>
      <ThemedView style={styles.sheet}>
        <SafeAreaView style={styles.sheetSafeArea} edges={['top', 'bottom']}>
          <View style={styles.sheetHeader}>
            <ThemedText type="heading">Country</ThemedText>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              hitSlop={Spacing.two}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="label" themeColor="accentInk">
                Done
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search countries"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
                style={[styles.input, { color: theme.text }]}
                accessibilityLabel="Search countries"
              />
            </View>
          </View>

          <FlatList
            data={matches}
            keyExtractor={(country) => country.code}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            // The field is optional, so there has to be a way back out of an
            // answer. Only shown once there is something to undo.
            ListHeaderComponent={
              selectedCode ? (
                <Pressable
                  onPress={() => onSelect(null)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="label" themeColor="textSecondary">
                    Clear
                  </ThemedText>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <ThemedText type="body" themeColor="textSecondary" style={styles.empty}>
                No country matches “{search.trim()}”.
              </ThemedText>
            }
            renderItem={({ item }) => (
              <Row
                country={item}
                selected={item.code === selectedCode}
                onPress={() => onSelect(item.code)}
              />
            )}
          />
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

function Row({
  country,
  selected,
  onPress,
}: {
  country: Country;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? theme.accentWash : theme.backgroundElement,
          borderColor: selected ? theme.accent : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="label" themeColor={selected ? 'accentInk' : 'text'} style={styles.rowName}>
        {country.name}
      </ThemedText>
      <ThemedText type="label" themeColor="textSecondary">
        {country.code}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Matches the 16 + 20 + 16 of a TextInput exactly, so a country field and an
  // email field in the same column have the same height.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 16,
  },
  fieldText: {
    ...FieldText,
    flex: 1,
  },
  sheet: {
    flex: 1,
  },
  sheetSafeArea: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
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
  rowName: {
    flex: 1,
  },
  empty: {
    paddingVertical: Spacing.five,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
