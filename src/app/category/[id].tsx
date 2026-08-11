/**
 * Create or edit a category. `/category/new` creates; `/category/<uuid>` edits.
 *
 * Categories are the "what did I buy" axis, shared across every budget — so
 * this screen deliberately has no budget field. If it had one, the two axes
 * would collapse back into one and the envelope model would stop meaning
 * anything.
 */

import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { CategoricalPalette, nextFreeSlot, slotColor } from '@/constants/palette';
import { FieldText, MaxContentWidth, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { confirmDestructive } from '@/lib/confirm';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

/** SF Symbol / Material Symbol pairs that read the same on both platforms. */
const ICONS = [
  'cart',
  'fork.knife',
  'car',
  'bolt',
  'bag',
  'sparkles',
  'house',
  'heart',
  'book',
  'gift',
  'airplane',
  'tag',
];

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dismiss = useDismiss();
  const navigation = useNavigation();
  const theme = useTheme();
  const scheme = useScheme();
  const { categories, mutate } = useData();

  const isNew = id === 'new';
  const existing = categories.find((category) => category.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? ICONS[0]);
  const [colorSlot, setColorSlot] = useState(
    existing?.colorSlot ?? nextFreeSlot(categories.map((category) => category.colorSlot))
  );

  useEffect(() => {
    navigation.setOptions({ title: isNew ? 'New category' : 'Edit category' });
  }, [navigation, isNew]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  async function save() {
    if (!canSave) return;
    const input = { name: trimmedName, icon, colorSlot };

    await mutate(async (repo) => {
      if (isNew) await repo.createCategory(input);
      else await repo.updateCategory(id, input);
    });
    dismiss();
  }

  async function confirmDelete() {
    const confirmed = await confirmDestructive(
      `Delete ${existing?.name}?`,
      'Expenses tagged with it are kept and shown as uncategorised.'
    );
    if (!confirmed) return;

    await mutate((repo) => repo.deleteCategory(id));
    dismiss();
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name">
          <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Coffee"
              placeholderTextColor={theme.textSecondary}
              autoFocus={isNew}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Category name"
            />
          </View>
        </Field>

        <Field label="Icon">
          <View style={styles.row}>
            {ICONS.map((option) => (
              <Chip
                key={option}
                label={option.split('.')[0]}
                selected={icon === option}
                onPress={() => setIcon(option)}
              />
            ))}
          </View>
        </Field>

        <Field label="Colour">
          <View style={styles.row}>
            {CategoricalPalette[scheme].map((_, slot) => (
              <Pressable
                key={slot}
                onPress={() => setColorSlot(slot)}
                accessibilityRole="button"
                accessibilityLabel={`Colour ${slot + 1}`}
                accessibilityState={{ selected: colorSlot === slot }}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: slotColor(slot, scheme),
                    borderColor: colorSlot === slot ? theme.text : 'transparent',
                  },
                ]}
              />
            ))}
          </View>
        </Field>

        <Button label={isNew ? 'Create category' : 'Save changes'} onPress={save} disabled={!canSave} />

        {!isNew && existing && (
          <Button label="Delete category" onPress={confirmDelete} variant="danger" />
        )}
      </ScrollView>
    </ThemedView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  field: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  inputWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 14,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.6,
  },
});
