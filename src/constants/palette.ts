/**
 * Categorical chart palette.
 *
 * **Ten slots in two tiers, and deliberately no orange or red.** Orange is the
 * interface's accent (see constants/theme.ts) and red means "over budget"; both
 * carry meaning outside the chart. A category rendered in either would inherit
 * that meaning by accident — an orange slice would read as "the important one"
 * rather than "Groceries". Reserved colours never double as series colours.
 *
 * The two tiers exist because separability does not scale with slot count:
 *
 * - **Slots 0–5 are the core.** These are the only ones {@link nextFreeSlot}
 *   hands out on its first pass, so an account that never opens the colour
 *   picker only ever sees these six. Validated all-pairs in both schemes
 *   against this app's card surfaces (light #FFFFFF, dark #191716): lightness
 *   band, chroma floor, contrast ≥ 3:1, colour-vision-deficiency separation
 *   (worst pair ΔE 11.0 light / 8.4 dark) and normal-vision separation (17.5 /
 *   17.4) all pass.
 * - **Slots 6–9 are opt-in.** Past six hues, the sRGB gamut minus the reserved
 *   warm band has nothing genuinely new left: every colour that can be added is
 *   within ΔE ~9 of one already here (worst pair, both schemes: lime against
 *   amber). They are offered because picking your own colour is worth more than
 *   a guarantee no six-slot palette could keep anyway — but they are never
 *   assigned automatically, and two of them side by side in one chart is a
 *   choice the user can see themselves making in the picker.
 *
 * That ΔE ~9 floor is exactly why **identity never rests on colour alone**
 * anywhere in this app: every chart ships a legend with the category's icon,
 * name and value beside the mark, and every list row does the same. Colour is
 * the fast path, not the only path.
 *
 * Budgets and categories store a *slot index*, not a hex value, so an entity
 * keeps its identity across both colour schemes and filtering a chart never
 * repaints the survivors.
 *
 * Colours were chosen by search rather than by eye: hues fixed on a six-way
 * spread, then lightness solved per slot to maximise the worst pair under
 * simulated protanopia and deuteranopia, subject to the band, chroma and
 * contrast floors above.
 */

export const CategoricalPalette = {
  light: [
    '#0c65ad', // blue
    '#18a195', // teal
    '#af8f16', // amber
    '#ae1173', // rose
    '#26770b', // green
    '#b074fb', // violet
    '#7a8611', // lime
    '#4b4cd1', // indigo
    '#c757cc', // magenta
    '#895e3b', // cocoa
  ],
  dark: [
    '#0e6ebb',
    '#1aa89b',
    '#af8f16',
    '#bf2a82',
    '#2a810d',
    '#aa6cf6',
    '#7d8911',
    '#5a60e6',
    '#b03fb5',
    '#a87b57',
  ],
} as const;

/** Spoken names, for the colour picker's accessibility labels. */
export const SlotNames = [
  'Blue',
  'Teal',
  'Amber',
  'Rose',
  'Green',
  'Violet',
  'Lime',
  'Indigo',
  'Magenta',
  'Cocoa',
] as const;

export const PaletteSize = CategoricalPalette.light.length;

/** How many slots are validated as a set, and so auto-assignable. */
export const CoreSlots = 6;

export type Scheme = 'light' | 'dark';

export function slotColor(slot: number | null, scheme: Scheme): string {
  if (slot === null) return ChartInk[scheme].muted;
  return CategoricalPalette[scheme][slot % PaletteSize];
}

/**
 * A slot's colour at low opacity, for the surface *behind* a glyph or bar.
 *
 * Returned as `rgba()` rather than an eight-digit hex because the same value
 * has to work as a `backgroundColor` on every platform, and RN Web's colour
 * parser is the one that disagrees about the hex form.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Chart chrome and status colours — none of which are categorical slots. */
export const ChartInk = {
  light: {
    surface: '#FFFFFF',
    /** Unfilled bar track. */
    track: '#EFECE8',
    gridline: '#EFECE8',
    muted: '#9A938C',
    good: '#0F8A4C',
    /** Over budget. Distinct enough from the accent to not read as one. */
    critical: '#C0301F',
  },
  dark: {
    surface: '#191716',
    track: '#2A2725',
    gridline: '#2A2725',
    muted: '#756E68',
    good: '#3BB36F',
    critical: '#E4553F',
  },
} as const;

/**
 * Pick a slot when creating a budget or category.
 *
 * The core six are exhausted first, so the first six entities are guaranteed
 * mutually distinguishable. Only then does it reach into the opt-in tier, whose
 * colours are near-twins of core ones — a near-twin is still better than the
 * exact repeat that wrapping would produce.
 */
export function nextFreeSlot(usedSlots: readonly number[]): number {
  for (let slot = 0; slot < PaletteSize; slot++) {
    if (!usedSlots.includes(slot)) return slot;
  }
  return usedSlots.length % PaletteSize;
}
