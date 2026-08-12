/**
 * The category icon grid.
 *
 * Shows the glyphs themselves. The previous version listed their *names*
 * ("cart", "bolt", "sparkles") as text chips, which asked the user to imagine
 * a picture from a word and then never drew that picture anywhere in the app —
 * a field where nothing you choose is visible is a field nobody fills in
 * honestly.
 *
 * The selected icon is drawn in the category's chosen colour, so this grid
 * doubles as the preview of what the finished category will look like in a
 * list row. Everything unselected stays in secondary ink: forty tinted glyphs
 * would be a colour chart, not a picker.
 */

import { StyleSheet, View, Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Glyph } from '@/components/ui/glyph';
import { IconGroups } from '@/constants/icons';
import { withAlpha } from '@/constants/palette';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const CELL = 46;

export function IconPicker({
  selected,
  color,
  onSelect,
}: {
  selected: string;
  /** The category's colour, used to tint the selected cell. */
  color: string;
  onSelect: (key: string) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.groups}>
      {IconGroups.map((group) => (
        <View key={group.title} style={styles.group}>
          <ThemedText type="micro" themeColor="textMuted">
            {group.title}
          </ThemedText>
          <View style={styles.grid}>
            {group.icons.map((icon) => {
              const isSelected = icon.key === selected;
              return (
                <Pressable
                  key={icon.key}
                  onPress={() => onSelect(icon.key)}
                  accessibilityRole="button"
                  accessibilityLabel={icon.label}
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.cell,
                    {
                      backgroundColor: isSelected
                        ? withAlpha(color, 0.18)
                        : theme.backgroundElement,
                      borderColor: isSelected ? color : theme.border,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <Glyph
                    icon={icon.key}
                    size={22}
                    color={isSelected ? color : theme.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  groups: {
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: Radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
