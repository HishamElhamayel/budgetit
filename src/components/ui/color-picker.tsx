/**
 * The palette swatch grid, shared by the budget and category screens.
 *
 * Laid out as two explicit rows rather than one wrapping line so the split
 * lands where it means something: the six on top are the mutually-validated
 * core, the four below are the opt-in near-twins (see constants/palette.ts).
 * A wrapping row would break at whatever the screen width happened to allow
 * and put a core colour and an opt-in one on the same line.
 *
 * Selection is marked with a tick *inside* the swatch, not with a ring around
 * it. A ring reads as a second colour at swatch size — which is the one thing
 * a colour picker cannot afford.
 */

import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { CoreSlots, PaletteSize, SlotNames, slotColor } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-scheme';

const SWATCH = 40;

export function ColorPicker({
  selected,
  onSelect,
}: {
  selected: number;
  onSelect: (slot: number) => void;
}) {
  const scheme = useScheme();
  const slots = Array.from({ length: PaletteSize }, (_, slot) => slot);

  return (
    <View style={styles.rows}>
      {[slots.slice(0, CoreSlots), slots.slice(CoreSlots)].map((row, index) => (
        <View key={index} style={styles.row}>
          {row.map((slot) => (
            <Pressable
              key={slot}
              onPress={() => onSelect(slot)}
              accessibilityRole="button"
              accessibilityLabel={SlotNames[slot]}
              accessibilityState={{ selected: selected === slot }}
              style={({ pressed }) => [
                styles.swatch,
                { backgroundColor: slotColor(slot, scheme) },
                pressed && styles.pressed,
              ]}>
              {selected === slot && (
                <SymbolView
                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                  size={20}
                  weight="bold"
                  tintColor="#FFFFFF"
                />
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: SWATCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
