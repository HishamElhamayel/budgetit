/**
 * The window stepper: back a period, the window's name, forward a period.
 *
 * Both screens that show money over a span need the same three controls, and
 * they need them to *look* the same — Home and Activity are read against each
 * other ("the bars say I'm fine, what did I actually buy"), and a stepper that
 * sat differently on each would make the two windows look like different kinds
 * of thing rather than the same window seen twice.
 *
 * Forward is disabled rather than hidden at the present edge. A control that
 * vanishes takes its neighbours' positions with it, so the arrow the user is
 * tapping moves under their finger exactly when they reach the end.
 *
 * The jump-back chip sits beside the label instead of on a row of its own: it
 * only exists while the user is away from the present, and giving it its own
 * row would mean everything below the stepper shifted down the moment they
 * stepped back once. The label row reserves the chip's height for the same
 * reason.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { Spacing } from '@/constants/theme';

/** Tall enough for the jump chip, so its arrival shifts nothing. */
const LabelRowHeight = 30;

export function PeriodNav({
  label,
  subtitle,
  onPrev,
  onNext,
  jump,
  align = 'center',
  style,
}: {
  /** What the window is called — "August", "25 Jul – 24 Aug", "Today". */
  label: string;
  /** An optional second line under the label, for a summary of the window. */
  subtitle?: string;
  onPrev: () => void;
  /** Absent when there is nowhere forward to go, which dims the arrow. */
  onNext?: () => void;
  /** The way back to the present, shown only while it has somewhere to go. */
  jump?: { label: string; onPress: () => void };
  /**
   * `start` groups the arrows tight around a heading-sized label, for a wide
   * window: centred across 800px, the two arrows end up so far apart that
   * they stop reading as one control.
   */
  align?: 'center' | 'start';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      <ThemedText
        type="title"
        themeColor="textSecondary"
        accessibilityRole="button"
        accessibilityLabel="Previous period"
        style={styles.arrow}
        onPress={onPrev}>
        ‹
      </ThemedText>

      <View style={align === 'start' ? styles.startCenter : styles.center}>
        <View style={[styles.labelRow, align === 'start' && styles.startLabelRow]}>
          <ThemedText
            type={align === 'start' ? 'heading' : 'label'}
            numberOfLines={1}
            style={styles.label}>
            {label}
          </ThemedText>

          {jump && (
            <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)}>
              <Chip label={jump.label} onPress={jump.onPress} style={styles.jumpChip} />
            </Animated.View>
          )}
        </View>

        {subtitle !== undefined && (
          <ThemedText type="label" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        )}
      </View>

      <ThemedText
        type="title"
        themeColor="textSecondary"
        accessibilityRole="button"
        accessibilityLabel="Next period"
        accessibilityState={{ disabled: !onNext }}
        style={[styles.arrow, !onNext && styles.arrowDisabled]}
        onPress={onNext}>
        ›
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  arrow: {
    paddingHorizontal: Spacing.two,
  },
  arrowDisabled: {
    opacity: 0.25,
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  startCenter: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  startLabelRow: {
    justifyContent: 'flex-start',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: LabelRowHeight,
  },
  label: {
    flexShrink: 1,
  },
  // Smaller than a selection chip: this one is a way back, not an option in a
  // row of options, and at full size it would out-weigh the label it sits next
  // to.
  jumpChip: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
  },
});
