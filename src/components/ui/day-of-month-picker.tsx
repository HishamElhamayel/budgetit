/**
 * Pick the day a budget period restarts on.
 *
 * A calendar grid rather than the app's usual chip row: 31 chips wrap into a
 * ragged block where the 14th and the 21st sit in unpredictable places, and
 * finding a specific number in that is a scan, not a glance. Seven across gives
 * the numbers a fixed position each, which is the only reason a month grid is
 * worth the extra layout — it is not pretending to be a real calendar, and
 * deliberately doesn't align to weekdays, which would change with the month.
 *
 * `null` is offered as a leading option where the caller supports it, because
 * "follow the app setting" is a genuinely different answer from "the 25th, and
 * it happens to match" — one moves when payday moves and the other doesn't.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatOrdinalDay } from '@/lib/date';

const COLUMNS = 7;
const CELL = 40;
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** The days that don't exist in every month, and so get the clamping note. */
const SHORT_MONTH_DAYS = 29;

export function DayOfMonthPicker({
  selected,
  onSelect,
  followLabel,
}: {
  selected: number | null;
  onSelect: (day: number | null) => void;
  /**
   * Label for the "no explicit day" option, e.g. "Same as app (25th)". Omit it
   * and the picker requires a concrete day.
   */
  followLabel?: string;
}) {
  const theme = useTheme();

  const cellStyle = (isSelected: boolean, pressed: boolean) => [
    styles.cell,
    {
      backgroundColor: isSelected ? theme.accentWash : theme.backgroundElement,
      borderColor: isSelected ? theme.accent : theme.border,
    },
    pressed && styles.pressed,
  ];

  return (
    <View style={styles.container}>
      {followLabel && (
        <Pressable
          onPress={() => onSelect(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === null }}
          style={({ pressed }) => [
            styles.follow,
            {
              backgroundColor: selected === null ? theme.accentWash : theme.backgroundElement,
              borderColor: selected === null ? theme.accent : theme.border,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="label" themeColor={selected === null ? 'accentInk' : 'textSecondary'}>
            {followLabel}
          </ThemedText>
        </Pressable>
      )}

      <View style={styles.grid}>
        {DAYS.map((day) => (
          <Pressable
            key={day}
            onPress={() => onSelect(day)}
            accessibilityRole="button"
            accessibilityLabel={formatOrdinalDay(day)}
            accessibilityState={{ selected: selected === day }}
            style={({ pressed }) => cellStyle(selected === day, pressed)}>
            <ThemedText
              type="label"
              themeColor={selected === day ? 'accentInk' : 'text'}
              style={styles.number}>
              {day}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {/* Only once a day that can go missing is actually chosen. Explaining the
          February case to someone who picked the 3rd is noise. */}
      {selected !== null && selected >= SHORT_MONTH_DAYS && (
        <ThemedText type="label" themeColor="textSecondary">
          Months without a {formatOrdinalDay(selected)} restart on their last day instead.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    // Held to seven columns whatever the container width, so the numbers keep
    // fixed positions instead of reflowing between a phone and a tablet.
    maxWidth: COLUMNS * CELL + (COLUMNS - 1) * Spacing.two,
  },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: Radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    fontVariant: ['tabular-nums'],
  },
  follow: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.chip,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
