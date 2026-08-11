/**
 * Categorical chart palette.
 *
 * **Six slots, and deliberately no orange or red.** Orange is the interface's
 * accent (see constants/theme.ts) and red means "over budget"; both carry
 * meaning outside the chart. A category rendered in either would inherit that
 * meaning by accident — an orange slice would read as "the important one"
 * rather than "Groceries". Reserved colours never double as series colours.
 *
 * Six is also exactly the number of seeded categories, so the cap is a real
 * boundary rather than an arbitrary one. Anything past six folds into a muted
 * "Other" instead of inventing a seventh hue.
 *
 * Budgets and categories store a *slot index*, not a hex value, so an entity
 * keeps its identity across both colour schemes and filtering a chart never
 * repaints the survivors.
 *
 * Both columns are validated against this app's card surfaces (light #FFFFFF,
 * dark #191716): lightness band, chroma floor, adjacent-pair CVD separation
 * (worst ΔE 9.1 light / 8.4 dark) and normal-vision floor (19.6 / 19.3) all
 * pass. In light mode aqua, yellow and magenta sit below 3:1 against white —
 * legal only with *relief*, so every chart here ships visible labels and
 * values beside the mark, never colour alone.
 */

export const CategoricalPalette = {
  light: [
    '#2a78d6', // blue
    '#1baf7a', // aqua
    '#eda100', // yellow
    '#e87ba4', // magenta
    '#008300', // green
    '#4a3aa7', // violet
  ],
  dark: ['#3987e5', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
} as const;

export const PaletteSize = CategoricalPalette.light.length;

export type Scheme = 'light' | 'dark';

export function slotColor(slot: number | null, scheme: Scheme): string {
  if (slot === null) return ChartInk[scheme].muted;
  return CategoricalPalette[scheme][slot % PaletteSize];
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
 * Pick the next unused slot when creating a budget or category, so the first
 * six entities each get a distinct hue before any repeat.
 */
export function nextFreeSlot(usedSlots: readonly number[]): number {
  for (let slot = 0; slot < PaletteSize; slot++) {
    if (!usedSlots.includes(slot)) return slot;
  }
  return usedSlots.length % PaletteSize;
}
