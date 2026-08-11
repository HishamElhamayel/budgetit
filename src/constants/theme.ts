/**
 * Design tokens.
 *
 * One accent, used sparingly. Orange marks the things the app wants you to act
 * on or read first — the active tab, the primary button, the amount you're
 * entering, a budget's remaining headroom. Everything else is ink on paper.
 *
 * Because the accent carries that much meaning, it is deliberately *absent*
 * from the chart palette (see constants/palette.ts). If an orange donut slice
 * could appear beside an orange button, the colour would stop meaning
 * "act on this" and start meaning nothing at all.
 *
 * The ground is a warm off-white rather than pure white so that white cards
 * read as raised surfaces without needing a heavy shadow. Dark mode inverts
 * that relationship: a near-black ground with slightly lifted cards.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    /** Page ground — cards sit on top of this. */
    background: '#FAF9F7',
    /** Card / raised surface. Chart palettes are validated against this. */
    backgroundElement: '#FFFFFF',
    /** Selected chip / pressed row. */
    backgroundSelected: '#F1EEEA',
    /** Hairline border. Does the work a shadow would, at a fraction of the weight. */
    border: 'rgba(20,17,15,0.10)',

    text: '#14110F',
    textSecondary: '#6B6560',
    textMuted: '#9A938C',

    /** Fills, bars, active states. 3.5:1 on white — fine for marks, not body text. */
    accent: '#E0603A',
    /** Darker step for accent-coloured *text*, which needs to clear 4.5:1. */
    accentInk: '#B8461F',
    /** Tinted background for selected accent surfaces. */
    accentWash: '#FCEFE9',
  },
  dark: {
    background: '#0E0D0C',
    backgroundElement: '#191716',
    backgroundSelected: '#242120',
    border: 'rgba(255,255,255,0.10)',

    text: '#F6F3F0',
    textSecondary: '#A39C95',
    textMuted: '#756E68',

    accent: '#FF7A4D',
    accentInk: '#FF9670',
    accentWash: '#2A1B14',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Type scale.
 *
 * Tracking tightens as size grows — at display sizes the default system
 * spacing reads loose and web-like, and pulling it in is most of what makes
 * large numbers feel deliberate rather than merely big.
 */
export const Type = {
  /** The amount being entered. Exactly one of these per screen. */
  display: { fontSize: 44, lineHeight: 48, fontWeight: '600', letterSpacing: -1.4 },
  title: { fontSize: 28, lineHeight: 33, fontWeight: '600', letterSpacing: -0.7 },
  heading: { fontSize: 19, lineHeight: 24, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '500', letterSpacing: -0.1 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0 },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 0.1 },
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

/** Corner radii. Cards are generous; controls are tighter so they read as controls. */
export const Radius = {
  chip: 999,
  control: 14,
  card: 22,
  sheet: 28,
} as const;

/**
 * Height the floating tab bar occupies, including its gap from the bottom.
 * Scroll views add this to their bottom padding so content can clear it.
 */
export const BottomTabInset = 96;
export const MaxContentWidth = 720;
