/**
 * The browser's own date/time field, standing in for the native picker.
 *
 * `@react-native-community/datetimepicker` renders `null` on web, so this is
 * what makes a date field exist at all in the browser. It mirrors the iOS
 * *compact* picker rather than the Android dialog: a field that sits in the
 * row and opens its own overlay. That is the shape every call site already
 * renders for `Platform.OS !== 'android'`, and a real `<input type="date">`
 * gets the platform's picker for free — the wheel on iPhone Safari, a calendar
 * on desktop — with no dialog state to keep in sync.
 *
 * Styled as an unselected chip, like the native compact picker: it always
 * shows a date, so dressing it as *selected* would put two selections in a row
 * whenever one of the quick chips beside it is the active one.
 */

import type { DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import type { CSSProperties } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useScheme } from '@/hooks/use-scheme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  value: Date;
  mode?: 'date' | 'time';
  minimumDate?: Date;
  maximumDate?: Date;
  onValueChange?: (event: DateTimePickerChangeEvent, date: Date) => void;
  style?: StyleProp<ViewStyle>;
  // Native-only props: accepted so call sites stay platform-agnostic, and
  // ignored because the browser's field takes its look from `color-scheme`
  // and `accent-color` instead.
  display?: string;
  themeVariant?: 'light' | 'dark';
  accentColor?: string;
  onDismiss?: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeString(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local-time parse. `new Date('2026-11-02')` would be UTC midnight instead. */
function parse(raw: string, mode: 'date' | 'time', base: Date): Date | null {
  if (!raw) return null;

  if (mode === 'time') {
    const [hours, minutes] = raw.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    const next = new Date(base);
    next.setHours(hours, minutes, 0, 0);
    return next;
  }

  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export default function DateTimePicker({
  value,
  mode = 'date',
  minimumDate,
  maximumDate,
  onValueChange,
  style,
}: Props) {
  const theme = useTheme();
  const scheme = useScheme();
  const format = mode === 'time' ? toTimeString : toDateString;

  const inputStyle: CSSProperties = {
    appearance: 'none',
    WebkitAppearance: 'none',
    boxSizing: 'border-box',
    minHeight: 38,
    margin: 0,
    paddingBlock: 7,
    paddingInline: Spacing.three,
    borderRadius: Radius.chip,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.backgroundElement,
    color: theme.text,
    fontFamily: 'Archivo, "Helvetica Neue", Arial, sans-serif',
    // 16px, not the chips' 13: iOS Safari zooms the page into any field under
    // 16px when it takes focus. It also matches the native compact picker,
    // which draws its value at body size rather than label size.
    fontSize: 16,
    lineHeight: '20px',
    fontWeight: 600,
    colorScheme: scheme,
    accentColor: theme.accent,
    outlineColor: theme.accent,
    cursor: 'pointer',
  };

  return (
    // `flex-start` so the field sizes to its value like a chip, instead of
    // stretching across whatever column it lands in.
    <View style={[styles.wrap, style]}>
      <input
        type={mode}
        value={format(value)}
        min={minimumDate ? format(minimumDate) : undefined}
        max={maximumDate ? format(maximumDate) : undefined}
        style={inputStyle}
        onChange={(event) => {
          const next = parse(event.currentTarget.value, mode, value);
          if (!next) return;
          // `min`/`max` only constrain the popup — a typed date sails past
          // them, so they're enforced here as well.
          if (mode === 'date') {
            if (minimumDate && toDateString(next) < toDateString(minimumDate)) return;
            if (maximumDate && toDateString(next) > toDateString(maximumDate)) return;
          }
          const timestamp = next.getTime();
          onValueChange?.(
            { nativeEvent: { timestamp, utcOffset: -next.getTimezoneOffset() } },
            next
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
  },
});
