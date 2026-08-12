/**
 * Spend-by-category donut.
 *
 * Hand-rolled on `react-native-svg` rather than pulled from a chart library:
 * the app needs exactly two chart forms, and the popular RN chart packages
 * drag in `react-native-linear-gradient`, which needs a native build and would
 * cost us Expo Go. Two hundred lines of arc math is the cheaper trade.
 *
 * Design contract (see constants/palette.ts):
 * - Segments are separated by a 3px gap in the surface colour, never a stroke,
 *   and sit on a track ring so an empty month still draws as a chart rather
 *   than as blank space.
 * - **Ends are square, not rounded.** A round cap adds half the ring's
 *   thickness to each end of a segment, which on a 2% slice is most of its
 *   length again — the small slices would draw larger than the number beside
 *   them says they are. Rounding is worth a lot of polish and not worth that.
 * - Identity never rests on colour alone — the legend beside the ring carries
 *   the category's icon, name and value, which is also the relief the palette's
 *   ΔE floor requires past the core six slots.
 * - Tapping a slice or its legend row focuses it: the segment lifts out of the
 *   ring, everything else recedes, and the hole switches from the month's total
 *   to that category's. It is the one interaction a donut genuinely needs —
 *   "how much *was* that slice" is otherwise a question the chart makes you
 *   answer by matching a colour to a list.
 * - Past the slice cap the tail folds into "Other" rather than growing a
 *   legend nobody reads to the bottom.
 */

import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { GlyphDisc } from '@/components/ui/glyph';
import { ChartInk, slotColor, withAlpha } from '@/constants/palette';
import { Radius, Spacing } from '@/constants/theme';
import type { CategoryTotal } from '@/db/types';
import { useScheme } from '@/hooks/use-scheme';
import { formatMoney, percentOf } from '@/lib/money';

const SIZE = 216;
const THICKNESS = 18;
/** Gap between segments, in px along the ring's centre line. */
const GAP = 3;
/** How far a focused segment steps out of the ring. */
const LIFT = 5;

/**
 * Named slices before the tail folds into "Other".
 *
 * Not tied to the palette's slot count any more: ten slots is how many colours
 * a user may *choose from*, while this is how many rows the legend can carry
 * before it stops being a legend and becomes a second list of the same
 * expenses the Activity tab already has.
 */
const MaxSlices = 8;

interface DonutSlice {
  key: string;
  label: string;
  icon: string | null;
  value: number;
  color: string;
}

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  // -90° puts the first segment at 12 o'clock and runs clockwise.
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function ringSegment(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startDeg: number,
  endDeg: number
): string {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const outerStart = polar(cx, cy, outer, startDeg);
  const outerEnd = polar(cx, cy, outer, endDeg);
  const innerEnd = polar(cx, cy, inner, endDeg);
  const innerStart = polar(cx, cy, inner, startDeg);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

/** Folds everything past {@link MaxSlices} into a single "Other". */
export function foldToTopSlices(totals: CategoryTotal[]): CategoryTotal[] {
  if (totals.length <= MaxSlices) return totals;

  const head = totals.slice(0, MaxSlices - 1);
  const tail = totals.slice(MaxSlices - 1);

  return [
    ...head,
    {
      categoryId: null,
      name: 'Other',
      icon: null,
      colorSlot: null,
      totalMinor: tail.reduce((sum, entry) => sum + entry.totalMinor, 0),
    },
  ];
}

/** "3%", or "<1%" for the slices that would otherwise round away to nothing. */
function shareLabel(value: number, total: number): string {
  const share = percentOf(value, total) * 100;
  if (share > 0 && share < 0.5) return '<1%';
  return `${Math.round(share)}%`;
}

/**
 * The largest type step the hole can hold this amount at, chosen from the
 * string's length rather than left to `adjustsFontSizeToFit`.
 *
 * Shrink-to-fit is the obvious answer and it is a native-only one: on web the
 * prop is ignored outright, so "QAR 3,700.06" rendered as "QAR 3,7…" in the
 * middle of the chart. Sizing up front is one line of arithmetic and it is
 * right everywhere; the shrink prop stays on underneath as a backstop for the
 * currencies whose symbols are wider than this estimate assumes.
 */
function centerType(text: string, width: number): 'title' | 'heading' | 'body' {
  // Average glyph advance as a fraction of font size, for a tabular sans.
  const fits = (fontSize: number) => text.length * fontSize * 0.58 <= width;
  if (fits(28)) return 'title';
  if (fits(19)) return 'heading';
  return 'body';
}

export function DonutChart({
  totals,
  currencyCode,
  centerLabel,
}: {
  totals: CategoryTotal[];
  currencyCode: string;
  centerLabel: string;
}) {
  const scheme = useScheme();
  const ink = ChartInk[scheme];
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const slices = useMemo<DonutSlice[]>(
    () =>
      foldToTopSlices(totals).map((entry) => ({
        key: entry.categoryId ?? entry.name,
        label: entry.name,
        icon: entry.icon,
        value: entry.totalMinor,
        color: slotColor(entry.colorSlot, scheme),
      })),
    [totals, scheme]
  );

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  // Deliberately derived rather than cleaned up in an effect: when the month
  // changes under a focused slice, the key simply stops matching and the chart
  // falls back to the total, which is the right answer anyway.
  const focused = slices.find((slice) => slice.key === focusedKey) ?? null;

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  // The ring sits a lift's width inside the box so a focused segment has
  // somewhere to step out to without being clipped.
  const outer = SIZE / 2 - LIFT;
  const inner = outer - THICKNESS;
  const midRadius = (outer + inner) / 2;
  /** The gap expressed as an angle at the ring's centre line. */
  const gapDeg = (GAP / (2 * Math.PI * midRadius)) * 360;

  const segments = useMemo(() => {
    // Running start angle per slice, accumulated without mutation.
    const starts = slices.reduce<number[]>(
      (acc, slice) => [...acc, acc[acc.length - 1] + (slice.value / total) * 360],
      [0]
    );

    return slices.map((slice, index) => {
      const sweep = (slice.value / total) * 360;
      const start = starts[index];
      const isFocused = slice.key === focused?.key;

      // A segment thinner than the gap itself would invert; clamp to a hairline.
      const inset = Math.min(gapDeg / 2, sweep / 2 - 0.01);
      return {
        ...slice,
        isFocused,
        path: ringSegment(
          cx,
          cy,
          isFocused ? outer + LIFT : outer,
          inner,
          start + inset,
          start + sweep - inset
        ),
      };
    });
  }, [slices, total, gapDeg, cx, cy, outer, inner, focused]);

  function toggle(key: string) {
    setFocusedKey((current) => (current === key ? null : key));
  }

  const centerWidth = inner * 2 - Spacing.four;
  const centerValue = formatMoney(focused ? focused.value : total, currencyCode);

  /**
   * Slices are only tappable on native. `react-native-svg` implements press
   * handling on web by forwarding React Native's responder props straight to
   * the DOM node, which React rejects — six "Unknown event handler property
   * `onResponderGrant`" errors per render, one per segment. The legend rows are
   * the same control by other means and they work everywhere, so the web build
   * simply loses the shortcut rather than the feature.
   */
  const sliceProps = (key: string) =>
    Platform.OS === 'web' ? {} : { onPress: () => toggle(key) };

  return (
    <View style={styles.container}>
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={cx}
            cy={cy}
            r={midRadius}
            stroke={ink.track}
            strokeWidth={THICKNESS}
            fill="none"
          />

          {total > 0 &&
            (slices.length === 1 ? (
              // A single 360° arc has identical start and end points and renders
              // as nothing — draw it as a stroked circle instead.
              <Circle
                cx={cx}
                cy={cy}
                r={midRadius}
                stroke={slices[0].color}
                strokeWidth={THICKNESS}
                fill="none"
                {...sliceProps(slices[0].key)}
              />
            ) : (
              <G>
                {segments.map((segment) => (
                  <Path
                    key={segment.key}
                    d={segment.path}
                    fill={segment.color}
                    // Everything but the focused slice recedes rather than
                    // disappearing: the ring has to stay a whole to be read as
                    // parts of one month.
                    opacity={focused && !segment.isFocused ? 0.3 : 1}
                    {...sliceProps(segment.key)}
                  />
                ))}
              </G>
            ))}
        </Svg>

        <View style={[styles.center, { width: centerWidth }]} pointerEvents="none">
          <ThemedText type="label" themeColor="textSecondary" numberOfLines={1}>
            {focused ? focused.label : centerLabel}
          </ThemedText>
          <ThemedText
            type={centerType(centerValue, centerWidth)}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            tabular
            style={styles.centerValue}>
            {centerValue}
          </ThemedText>
          {focused && (
            <ThemedText type="label" themeColor="textMuted">
              {shareLabel(focused.value, total)} of spend
            </ThemedText>
          )}
        </View>
      </View>

      <View style={styles.legend}>
        {slices.map((slice) => {
          const isFocused = slice.key === focused?.key;
          return (
            <Pressable
              key={slice.key}
              onPress={() => toggle(slice.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={`${slice.label}, ${formatMoney(slice.value, currencyCode)}, ${shareLabel(slice.value, total)} of spend`}
              style={({ pressed }) => [
                styles.legendRow,
                isFocused && { backgroundColor: withAlpha(slice.color, 0.12) },
                pressed && styles.pressed,
              ]}>
              <GlyphDisc icon={slice.icon} color={slice.color} size={30} />
              <ThemedText numberOfLines={1} style={styles.legendLabel}>
                {slice.label}
              </ThemedText>
              <ThemedText type="label" themeColor="textMuted" tabular style={styles.legendShare}>
                {shareLabel(slice.value, total)}
              </ThemedText>
              <ThemedText type="label" tabular style={styles.legendAmount}>
                {formatMoney(slice.value, currencyCode)}
              </ThemedText>
            </Pressable>
          );
        })}

        {slices.length === 0 && (
          <ThemedText type="label" themeColor="textMuted" style={styles.empty}>
            No spending logged yet.
          </ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  ringWrap: {
    alignSelf: 'center',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  centerValue: {
    textAlign: 'center',
  },
  legend: {
    gap: Spacing.half,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Padding rather than margin so the focused row's wash reads as a block
    // around the row instead of a stripe behind its text.
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Radius.control,
  },
  legendLabel: {
    flex: 1,
  },
  legendShare: {
    minWidth: 38,
    textAlign: 'right',
  },
  legendAmount: {
    minWidth: 76,
    textAlign: 'right',
  },
  empty: {
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
