/**
 * Spend-by-category donut.
 *
 * Hand-rolled on `react-native-svg` rather than pulled from a chart library:
 * the app needs exactly two chart forms, and the popular RN chart packages
 * drag in `react-native-linear-gradient`, which needs a native build and would
 * cost us Expo Go. Two hundred lines of arc math is the cheaper trade.
 *
 * Design contract (see constants/palette.ts):
 * - Segments are separated by a 2px gap in the surface colour, never a stroke.
 * - Identity never rests on colour alone — the legend beside the ring carries a
 *   swatch, a name and a value, which is also the relief the light-mode
 *   contrast warning requires.
 * - Past six categories the tail folds into "Other" rather than inventing a
 *   seventh hue — and neither orange nor red appears, since both mean
 *   something outside the chart (see constants/palette.ts).
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ChartInk, PaletteSize, slotColor } from '@/constants/palette';
import { Spacing } from '@/constants/theme';
import type { CategoryTotal } from '@/db/types';
import { useScheme } from '@/hooks/use-scheme';
import { formatMoney, percentOf } from '@/lib/money';

const SIZE = 168;
const THICKNESS = 26;
/** Gap between segments, in px along the ring's centre line. */
const GAP = 2;

interface DonutSlice {
  key: string;
  label: string;
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

/** Folds everything past the palette's six slots into a single "Other". */
export function foldToPalette(totals: CategoryTotal[]): CategoryTotal[] {
  if (totals.length <= PaletteSize) return totals;

  const head = totals.slice(0, PaletteSize - 1);
  const tail = totals.slice(PaletteSize - 1);

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

  const slices = useMemo<DonutSlice[]>(
    () =>
      foldToPalette(totals).map((entry) => ({
        key: entry.categoryId ?? entry.name,
        label: entry.name,
        value: entry.totalMinor,
        color: slotColor(entry.colorSlot, scheme),
      })),
    [totals, scheme]
  );

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outer = SIZE / 2;
  const inner = outer - THICKNESS;
  const midRadius = (outer + inner) / 2;
  /** The 2px surface gap expressed as an angle at the ring's centre line. */
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

      // A segment thinner than the gap itself would invert; clamp to a hairline.
      const inset = Math.min(gapDeg / 2, sweep / 2 - 0.01);
      return {
        ...slice,
        path: ringSegment(cx, cy, outer, inner, start + inset, start + sweep - inset),
      };
    });
  }, [slices, total, gapDeg, cx, cy, outer, inner]);

  return (
    <View style={styles.container}>
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          {total === 0 ? (
            <Circle
              cx={cx}
              cy={cy}
              r={midRadius}
              stroke={ink.track}
              strokeWidth={THICKNESS}
              fill="none"
            />
          ) : slices.length === 1 ? (
            // A single 360° arc has identical start and end points and renders
            // as nothing — draw it as a stroked circle instead.
            <Circle
              cx={cx}
              cy={cy}
              r={midRadius}
              stroke={slices[0].color}
              strokeWidth={THICKNESS}
              fill="none"
            />
          ) : (
            <G>
              {segments.map((segment) => (
                <Path key={segment.key} d={segment.path} fill={segment.color} />
              ))}
            </G>
          )}
        </Svg>

        <View style={styles.center} pointerEvents="none">
          <ThemedText type="label" themeColor="textSecondary">
            {centerLabel}
          </ThemedText>
          <ThemedText type="title">
            {formatMoney(total, currencyCode, { compact: total >= 1_000_00 })}
          </ThemedText>
        </View>
      </View>

      <View style={styles.legend}>
        {slices.map((slice) => (
          <View key={slice.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: slice.color }]} />
            <ThemedText type="label" numberOfLines={1} style={styles.legendLabel}>
              {slice.label}
            </ThemedText>
            <ThemedText
              type="label"
              themeColor="textMuted"
              tabular
              style={styles.legendValue}>
              {Math.round(percentOf(slice.value, total) * 100)}%
            </ThemedText>
            <ThemedText type="label" tabular style={styles.legendAmount}>
              {formatMoney(slice.value, currencyCode)}
            </ThemedText>
          </View>
        ))}
        {slices.length === 0 && (
          <ThemedText type="label" themeColor="textMuted">
            No spending logged yet.
          </ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.four,
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    gap: Spacing.two,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legendLabel: {
    flex: 1,
  },
  legendValue: {
    minWidth: 40,
    textAlign: 'right',
  },
  legendAmount: {
    minWidth: 76,
    textAlign: 'right',
  },
});
