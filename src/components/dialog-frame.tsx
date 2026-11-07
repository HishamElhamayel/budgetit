/**
 * A form screen, presented as a dialog over the page that opened it.
 *
 * Wide web only. On a phone every form is a full-screen sheet, which is right
 * for a phone; on a desktop the same sheet blanks a 1400px window to show a
 * 500px form, and the user loses the dashboard they were acting on. As a dialog
 * the page stays visible behind it, so editing a budget happens *over* the bars
 * it changes.
 *
 * The route still does the work — this is mounted by the root Stack's
 * `screenLayout` around routes presented as `transparentModal`, following
 * Expo's web-modal guide — so URLs, back and deep links behave exactly as they
 * do for the sheet. Dismissing is `router.back()`, and a dialog opened from a
 * pasted link with no history falls back to Home.
 */

import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PressableState = { pressed: boolean; hovered?: boolean; focused?: boolean };

export function DialogFrame({
  title,
  dismissible = true,
  children,
}: {
  /** Shown in the dialog's own title bar. Omit when the route draws its own header. */
  title?: string;
  /** False for flows that must be finished, like onboarding. */
  dismissible?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const theme = useTheme();

  const dismiss = () => {
    if (!dismissible) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  useEffect(() => {
    if (!dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // `dismiss` closes over the router, which is stable for the dialog's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissible]);

  return (
    <View style={styles.overlay}>
      <Animated.View entering={FadeIn.duration(120)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable
          accessibilityLabel={dismissible ? 'Close' : undefined}
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
          // The backdrop is a mouse target only. Keyboard users have Escape and
          // the close button, and a focusable full-screen layer would be the
          // first tab stop in every dialog.
          focusable={false}
        />
      </Animated.View>

      <Animated.View
        entering={FadeIn.duration(160)}
        role="dialog"
        aria-modal
        aria-label={title}
        style={[
          styles.dialog,
          { backgroundColor: theme.background, borderColor: theme.border },
        ]}>
        {title !== undefined ? (
          <View style={[styles.titleBar, { borderBottomColor: theme.border }]}>
            <ThemedText type="heading" style={styles.title} numberOfLines={1}>
              {title}
            </ThemedText>
            {dismissible && <CloseButton onPress={dismiss} />}
          </View>
        ) : (
          dismissible && (
            <View style={styles.floatingClose}>
              <CloseButton onPress={dismiss} />
            </View>
          )
        )}
        <View style={styles.body}>{children}</View>
      </Animated.View>
    </View>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={({ hovered, pressed, focused }: PressableState) => [
        styles.close,
        (hovered || pressed) && { backgroundColor: theme.backgroundSelected },
        focused && { outlineColor: theme.accent, ...styles.focusRing },
      ]}>
      <Svg width={14} height={14} viewBox="0 0 14 14">
        <Path
          d="M2 2 L12 12 M12 2 L2 12"
          stroke={theme.textSecondary}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
  },
  scrim: {
    backgroundColor: 'rgba(15, 17, 19, 0.42)',
  },
  dialog: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '100%',
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(15, 17, 19, 0.22)',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
  },
  floatingClose: {
    position: 'absolute',
    top: Spacing.two + 2,
    right: Spacing.three,
    zIndex: 1,
  },
  body: {
    // Shrinks to fit the viewport and lets the route's own ScrollView take over
    // past that, rather than growing the dialog off the bottom of the window.
    flexShrink: 1,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusRing: {
    outlineStyle: 'solid',
    outlineWidth: 2,
    outlineOffset: 2,
  } as object,
});
