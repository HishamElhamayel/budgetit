/**
 * The root HTML every web page is statically rendered into.
 *
 * Most of this is what lets budgetit be installed from Safari's "Add to Home
 * Screen" and run full-screen like an app, without going through the App
 * Store: the manifest, the apple-* tags, and `viewport-fit=cover` so the page
 * can draw under the notch and home indicator. Safe-area insets then come
 * through `env(safe-area-inset-*)`, which react-native-safe-area-context reads
 * on web — the same SafeAreaViews that pad the native app pad this.
 *
 * Runs only in Node at export time: no DOM, no global CSS, no providers.
 */

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { Colors } from '@/constants/theme';

// Painted before the bundle loads, so a dark-mode visitor doesn't get a white
// flash between the HTML arriving and React taking over.
const groundStyle = `
html, body { background-color: ${Colors.light.background}; }
@media (prefers-color-scheme: dark) {
  html, body { background-color: ${Colors.dark.background}; }
}`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        <meta name="description" content="Log expenses against budgets." />

        {/* Archivo, with its width axis — money figures are set at 125% (see
            constants/theme.ts). `display=swap` so text is never invisible
            while the font is on its way. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap"
        />
        <link rel="manifest" href="/manifest.json" />

        {/* Installed-app behaviour on iPhone. `black-translucent` lets the
            page's own ground show under the status bar in both themes, where
            `default` would pin a white bar over dark mode. */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="budgetit" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content={Colors.light.background}
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content={Colors.dark.background}
        />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: groundStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
