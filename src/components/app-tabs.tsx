/**
 * The floating tab bar.
 *
 * Built on `expo-router/ui` rather than the platform tab bar, because a native
 * bar is pinned edge-to-edge and can't float. The trade is real — we give up
 * the system blur and scroll-to-top — but the pill is load-bearing for the
 * design: it lets the ground show through underneath, which is what keeps the
 * bottom of the screen feeling light instead of walled off.
 *
 * The circular accent button beside it is deliberately *outside* the pill. It
 * isn't a destination like the three tabs, it's an action, and giving it its
 * own shape says so before anyone reads the icon.
 */

import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconName = 'home' | 'list' | 'person';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="home">Home</TabButton>
          </TabTrigger>
          <TabTrigger name="activity" href="/activity" asChild>
            <TabButton icon="list">Activity</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton icon="person">Profile</TabButton>
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

function TabBar({ children }: { children?: React.ReactNode }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView edges={['bottom']} style={styles.dock} pointerEvents="box-none">
      <View style={styles.dockRow} pointerEvents="box-none">
        <View
          style={[
            styles.pill,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          {children}
        </View>

        {/* Navigates imperatively rather than through `<Link asChild>`, which
            cannot carry this button's styling. `asChild` merges props with
            Radix's Slot, and its rule for `style` is a plain object spread:
            `{ ...linkStyle, ...childStyle }`. A function style — the only form
            that can react to `pressed` — spreads to nothing, so the fill, the
            56pt box and the radius were all silently dropped and what reached
            the screen was a bare white glyph on a white bar. */}
        <Pressable
          onPress={() => router.push('/create')}
          accessibilityRole="button"
          accessibilityLabel="Add income, budget or category"
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Svg width={20} height={20} viewBox="0 0 20 20">
            <Path d="M10 4 V16 M4 10 H16" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function TabButton({ children, icon, isFocused, ...props }: TabTriggerSlotProps & { icon: IconName }) {
  const theme = useTheme();
  const tint = isFocused ? theme.text : theme.textMuted;

  return (
    <Pressable {...props} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <TabIcon name={icon} color={tint} filled={isFocused === true} />
      <ThemedText type="micro" style={{ color: tint }}>
        {children}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Icons are drawn inline rather than pulled from an icon font: three glyphs
 * doesn't justify a dependency, and drawing them here means the filled and
 * outline states share exact geometry so the active tab doesn't shift.
 */
function TabIcon({ name, color, filled }: { name: IconName; color: string; filled: boolean }) {
  const stroke = { stroke: color, strokeWidth: 1.7, fill: 'none' as const };

  if (name === 'home') {
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Path
          d="M3.5 9.2 11 3.5l7.5 5.7v8.1a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"
          {...stroke}
          fill={filled ? color : 'none'}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === 'list') {
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        {[6, 11, 16].map((y, index) => (
          <Fragment key={y}>
            <Circle cx={5} cy={y} r={1.5} fill={color} opacity={filled || index === 0 ? 1 : 0.85} />
            <Rect x={8.5} y={y - 0.9} width={9.5} height={1.8} rx={0.9} fill={color} />
          </Fragment>
        ))}
      </Svg>
    );
  }

  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={11} cy={7.5} r={3.4} {...stroke} fill={filled ? color : 'none'} />
      <Path
        d="M4.5 18c0-3.3 2.9-5.6 6.5-5.6s6.5 2.3 6.5 5.6"
        {...stroke}
        fill={filled ? color : 'none'}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Both of these are here to *overrule* TabList. Rendering `asChild` makes it
    // merge `{ flexDirection: 'row', justifyContent: 'space-between' }` onto
    // whatever it wraps, and the child only wins on keys it names. Left
    // unnamed, the dock became a row, `dockRow` sized itself to its content
    // instead of the screen, and the add button was pushed off the right edge —
    // rendered, laid out, and entirely invisible.
    flexDirection: 'column',
    justifyContent: 'flex-end',
  },
  dockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Belt to the braces above: pinned to the dock's width, the row can't
    // resolve to its content width no matter what direction the dock ends up
    // in, so `pill`'s `flex: 1` always has a bounded space to shrink inside.
    width: '100%',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Shrink rather than overflow: the add button keeps its full size and the
    // pill gives up the space, otherwise the button runs off the right edge on
    // narrow screens.
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 420,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: Spacing.one,
  },
  addButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pressed: {
    opacity: 0.6,
  },
});
