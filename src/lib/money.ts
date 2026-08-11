/**
 * Money helpers. Everything in the app moves integer minor units around; these
 * are the only two places where a decimal string is produced or consumed.
 *
 * **The stored scale is always hundredths, whatever the currency.** A minor unit
 * here means 1/100 of a major unit — not "one cent of whatever is selected".
 * Currency is a *display* preference the user can change at any time, and if the
 * scale moved with it, every amount already in the database would silently
 * change value the moment someone switched from dollars to yen. Fixing the
 * scale means the number on a row is the number that was typed, forever.
 *
 * What the currency does decide is how that number is *written* and how much
 * precision the keypad accepts — see {@link currencyDigits}.
 */

import { currencyDigits } from '@/constants/currencies';

/**
 * Decimal places the amount keypad accepts for a currency.
 *
 * Capped at the two the stored scale can actually hold. That only bites the
 * three-decimal Gulf dinars, where it costs sub-fils precision — a real limit,
 * but a far smaller one than rounding every existing amount would be.
 */
function inputDigits(currencyCode: string): number {
  return Math.min(currencyDigits(currencyCode), 2);
}

/**
 * Parse user keypad input into minor units. Accepts "12", "12.5", "12.50",
 * "1,234.5" and returns null for anything that isn't a non-negative amount, or
 * that carries more decimals than the currency is written with — a yen amount
 * of "10.50" is not a rounding problem, it's a typo.
 */
export function parseAmountToMinor(input: string, currencyCode: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return null;

  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > inputDigits(currencyCode)) return null;

  const minor = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isFinite(minor) || minor <= 0) return null;
  return Math.round(minor);
}

export function formatMoney(
  minor: number,
  currencyCode: string,
  options: { compact?: boolean } = {}
): string {
  const digits = currencyDigits(currencyCode);

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
    // Whole amounts read faster without the trailing zeros in charts and list
    // rows. Below that, the currency's own convention decides: ¥1,200 never
    // wants decimals, and KD 10.500 always wants three.
    minimumFractionDigits: minor % 100 === 0 ? 0 : digits,
    maximumFractionDigits: digits,
    notation: options.compact ? 'compact' : 'standard',
  }).format(minor / 100);
}

/** Editable decimal string for a form field, e.g. 1250 -> "12.50". */
export function minorToInput(minor: number, currencyCode: string): string {
  return (minor / 100).toFixed(inputDigits(currencyCode));
}

export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return part / whole;
}
