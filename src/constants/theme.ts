/**
 * Design tokens.
 *
 * One accent, used sparingly: signal orange, the colour of the app icon. It
 * marks the things the app wants you to act on or read first — the active
 * destination, the primary button, the amount you're entering, a budget's
 * remaining headroom. Everything else is ink on paper.
 *
 * Signal orange is a safety-sign colour, and it is used the way signs use it:
 * *black* ink on the orange, never white. White on #FF5C21 is 3.1:1 and fails
 * for button labels; ink on it is 5.8:1 and reads from across a room.
 *
 * Because the accent carries that much meaning, it is deliberately *absent*
 * from the chart palette (see constants/palette.ts). If an orange donut slice
 * could appear beside an orange button, the colour would stop meaning
 * "act on this" and start meaning nothing at all.
 *
 * The ground is a cool grey paper rather than white so that white surfaces
 * read as raised without a heavy shadow, and cool rather than warm so the one
 * warm colour in the system is the accent. Dark mode inverts that: a graphite
 * ground with slightly lifted surfaces.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    /** Page ground — surfaces sit on top of this. */
    background: '#EEF0F2',
    /** Card / raised surface. Chart palettes are validated against this. */
    backgroundElement: '#FFFFFF',
    /** Selected chip / pressed row / hovered item. */
    backgroundSelected: '#E3E6EA',
    /** Hairline border. Does the work a shadow would, at a fraction of the weight. */
    border: 'rgba(21,24,28,0.11)',

    text: '#15181C',
    textSecondary: '#5A6169',
    textMuted: '#8C939B',

    /** Fills, bars, active states. 3.1:1 on white — for marks and fills, not text. */
    accent: '#FF5C21',
    /** Darker step for accent-coloured *text*: 5.3:1 on white, 4.6:1 on paper. */
    accentInk: '#C23D0B',
    /** Tinted background for selected accent surfaces. */
    accentWash: '#FFE8DE',
    /** Ink for anything drawn *on* the accent — see the note above. */
    onAccent: '#15181C',
  },
  dark: {
    background: '#0F1113',
    backgroundElement: '#191C20',
    backgroundSelected: '#23272C',
    border: 'rgba(255,255,255,0.09)',

    text: '#F1F3F5',
    textSecondary: '#A2A9B1',
    textMuted: '#6F777F',

    accent: '#FF6A33',
    accentInk: '#FF8A5C',
    accentWash: '#2A1910',
    onAccent: '#15181C',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * The typeface: Archivo, loaded from Google Fonts in app/+html.tsx.
 *
 * Chosen for its width axis. Text runs at normal width; money runs at 125% and
 * heavy, like a price on a sign. That one treatment is the app's signature,
 * and it is the only place the type gets loud — everything around a figure
 * stays at one modest weight per size so the figures have nothing to compete
 * with.
 *
 * Web only. Native has no Archivo bundled, so it keeps the system face and
 * simply ignores the width (`fontStretch` is a CSS property react-native-web
 * passes straight through).
 */
const Sans = Platform.select({
  web: 'Archivo, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

/** Spread into a text style to set it wide. No-op off the web. */
export const Wide = (Platform.OS === 'web' ? { fontStretch: '125%' } : {}) as object;

/**
 * Type scale.
 *
 * Steps follow a rough 1.25 ratio from a 16px body. Tracking tightens as size
 * grows — at display sizes default spacing reads loose, and pulling it in is
 * most of what makes large numbers feel deliberate rather than merely big.
 */
export const Type = {
  /** A money figure at full size — the amount being entered, what's left. */
  display: {
    fontFamily: Sans,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: '800',
    letterSpacing: -1,
    ...Wide,
  },
  /** A money figure at reading size — in, out, a budget's total. */
  figure: {
    fontFamily: Sans,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
    ...Wide,
  },
  title: { fontFamily: Sans, fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -0.6 },
  heading: { fontFamily: Sans, fontSize: 19, lineHeight: 25, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontFamily: Sans, fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  label: { fontFamily: Sans, fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0.05 },
  micro: { fontFamily: Sans, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.1 },
} as const;

/**
 * Typography for text *inside* a form field.
 *
 * Deliberately not a step on `Type`: it isn't a level in the hierarchy, it's
 * the one size every input shares so that fields line up whatever screen they
 * sit on.
 *
 * `letterSpacing` is pinned rather than left unset on purpose. A TextInput
 * draws its placeholder with the field's own text attributes, and an *absent*
 * letterSpacing hands tracking back to the platform, which applies its own
 * optical spacing to the hint — that is what makes one placeholder read airy
 * and the next cramped when the two fields are styled identically. Setting it
 * explicitly takes that discretion away.
 */
export const FieldText = {
  fontFamily: Sans,
  fontSize: 16,
  lineHeight: 20,
  fontWeight: '500',
  letterSpacing: 0,
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Corner radii. Three distinct steps so the radius itself says what a thing
 * is: chips are pills, controls are barely rounded, surfaces sit between.
 */
export const Radius = {
  chip: 999,
  control: 10,
  card: 16,
  sheet: 20,
} as const;

/**
 * Height the floating tab bar occupies, including its gap from the bottom.
 * Scroll views add this to their bottom padding so content can clear it.
 */
export const BottomTabInset = 96;
export const MaxContentWidth = 720;

/**
 * The wide layout: a sidebar instead of the floating tab bar, forms as dialogs
 * instead of full-screen sheets, and Home split into a dashboard and a
 * permanent entry panel. Below this the app keeps its phone layout, which is
 * also what an installed iPhone home-screen app gets.
 */
export const WideBreakpoint = 1024;
export const SidebarWidth = 232;
export const EntryPanelWidth = 380;
