/**
 * A one-time-code field drawn as one cell per digit.
 *
 * There is exactly one real TextInput; it sits invisibly across the whole row
 * and the cells are just a picture of its value. The obvious alternative — one
 * input per digit, with focus hopping between them — is what most apps reach
 * for and it breaks the two things that matter most here: iOS will only offer
 * "From Messages" autofill to a field that can hold the *entire* code, and
 * pasting or backspacing across separate inputs needs a pile of focus
 * bookkeeping that still gets the last cell wrong.
 *
 * Cells rather than one plain box because a code is a fixed number of
 * characters, and showing that count is the point — the user can see how many
 * digits are left without counting glyphs.
 */

import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function CodeField({
  value,
  length,
  onChange,
  autoFocus = false,
  editable = true,
  accessibilityLabel,
}: {
  value: string;
  length: number;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  // Eight cells need every point they can get on a narrow screen; six can
  // afford to breathe.
  const gap = length > 6 ? Spacing.one : Spacing.two;
  // The cell the next digit will land in. Once the code is full there is no
  // next cell, so the caret parks on the last one rather than off the end.
  const cursor = Math.min(value.length, length - 1);
  // Codes are read aloud and written down in two halves, so an even-length one
  // gets a separator. Odd lengths have no honest place to put it.
  const split = length > 4 && length % 2 === 0 ? length / 2 : -1;

  return (
    <View style={[styles.row, { gap }]}>
      {Array.from({ length }, (_, index) => {
        const digit = value[index];
        const active = focused && editable && index === cursor;

        return (
          <View key={index} style={styles.slot}>
            {index === split && (
              <View style={[styles.dash, { left: -gap, width: gap }]} pointerEvents="none">
                <ThemedText themeColor="textMuted">-</ThemedText>
              </View>
            )}
            <View
              style={[
                styles.cell,
                {
                  backgroundColor: theme.backgroundSelected,
                  borderColor: active ? theme.accent : 'transparent',
                },
              ]}>
              {digit ? (
                <ThemedText style={styles.digit} tabular>
                  {digit}
                </ThemedText>
              ) : (
                active && <Caret color={theme.accent} />
              )}
            </View>
          </View>
        );
      })}

      {/* Last in the tree so it stacks above the cells and takes the taps
          itself — no extra Pressable needed to move focus. */}
      <TextInput
        value={value}
        // Strip everything but digits so a code pasted with a stray space or a
        // hyphen still lands cleanly.
        onChangeText={(next) => onChange(next.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={length}
        // Between them, these are what put the code into the field straight
        // from the notification banner.
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        // We draw our own, positioned in the active cell.
        caretHidden
        style={styles.hidden}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

/** A blinking bar, since `caretHidden` took the real one away. */
function Caret({ color }: { color: string }) {
  // `useState` rather than `useRef` so the value is created once *and* read
  // outside render — a ref read during render is what the compiler objects to.
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 400, delay: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, delay: 100, useNativeDriver: true }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, [opacity]);

  return <Animated.View style={[styles.caret, { backgroundColor: color, opacity }]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Every cell takes an equal share of the row, so the group stays balanced at
  // any code length and on any screen width.
  slot: {
    flex: 1,
  },
  cell: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 56,
    borderRadius: Radius.control,
    // Always present, transparent when inactive: a border that appears on
    // focus would resize the cell and shove the whole row sideways.
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sits in the gap between the two halves, so it costs the cells no width.
  dash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    // A lone digit centred in a box has nothing to kern against, so the type
    // scale's negative tracking would just pull it off-centre.
    letterSpacing: 0,
  },
  caret: {
    width: 2,
    height: 24,
    borderRadius: 1,
  },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Invisible but still hit-testable and still focusable. The transparent
    // colour matters on web, where the value would otherwise paint over the
    // cells; the outline reset kills the browser's focus ring on a control
    // the user can't see anyway.
    opacity: 0,
    color: 'transparent',
    ...Platform.select({ web: { outlineStyle: 'none' } as object }),
  },
});
