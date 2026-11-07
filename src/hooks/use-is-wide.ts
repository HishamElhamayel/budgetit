import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { WideBreakpoint } from '@/constants/theme';

/**
 * Whether to draw the wide (desktop browser) layout.
 *
 * Web only: a landscape iPad running the native app keeps the layout it was
 * designed and tested with, and the wide shell leans on things only a browser
 * has — hover, a pointer, a keyboard that is always there.
 *
 * Narrow until hydrated, for the same reason `useColorScheme` waits: the page
 * is statically rendered with no window to measure, so the first client render
 * has to match that HTML before switching to what the window really is.
 */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Intentional: the point is to detect hydration, so the first client render
    // matches the static HTML. There is no external system to subscribe to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  return Platform.OS === 'web' && hydrated && width >= WideBreakpoint;
}
