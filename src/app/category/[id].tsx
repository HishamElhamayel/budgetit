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
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/ui/color-picker';
import { GlyphDisc } from '@/components/ui/glyph';
import { IconPicker } from '@/components/ui/icon-picker';
import { DefaultIconKey } from '@/constants/icons';
import { nextFreeSlot, slotColor } from '@/constants/palette';
import { FieldText, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useData } from '@/data/store';
import { useDismiss } from '@/hooks/use-dismiss';
import { confirmDestructive } from '@/lib/confirm';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

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
  const [icon, setIcon] = useState(existing?.icon ?? DefaultIconKey);
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
        {/* The row this category will become, drawn from the live form values.
            Icon and colour are choices with no consequence the user can see
            until they land somewhere — so the somewhere is here, above the
            fields, updating as they tap. */}
        <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
          <GlyphDisc icon={icon} color={slotColor(colorSlot, scheme)} size={44} />
          <ThemedText type="heading" numberOfLines={1} style={styles.previewName}>
            {trimmedName || 'New category'}
          </ThemedText>
        </View>

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

        <Field label="Colour">
          <ColorPicker selected={colorSlot} onSelect={setColorSlot} />
        </Field>

        <Field label="Icon">
          <IconPicker
            selected={icon}
            color={slotColor(colorSlot, scheme)}
            onSelect={setIcon}
          />
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
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  previewName: {
    flex: 1,
  },
  inputWrap: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  input: {
    ...FieldText,
    paddingVertical: 14,
  },
});
