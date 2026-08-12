/**
 * The category icon set.
 *
 * A category's `icon` column stores a **key from this file**, not a platform
 * symbol name. The key happens to look like an SF Symbol because the first
 * twelve were seeded that way, but the indirection is the point: iOS draws SF
 * Symbols and Android and web draw Material Symbols, and the two vocabularies
 * disagree on almost every name ("fork.knife" against "restaurant"). Storing a
 * key means a row written on an iPhone renders on Android without a lookup
 * table living in three components.
 *
 * Keys are append-only. Renaming one silently blanks the icon on every row that
 * already holds it, since a key with no entry falls back to the generic tag.
 *
 * Grouped, because a flat wall of fifty glyphs is a worse picker than five
 * short shelves — people arrive knowing the *kind* of thing they bought.
 */

import type { AndroidSymbol, SFSymbol } from 'expo-symbols';

export interface IconSpec {
  /** Stored in `categories.icon`. */
  key: string;
  /** Spoken name, for accessibility and the picker's fallback text. */
  label: string;
  ios: SFSymbol;
  material: AndroidSymbol;
}

export interface IconGroup {
  title: string;
  icons: IconSpec[];
}

/**
 * Tuples rather than object literals purely so the table below stays readable
 * at a glance — and typed, so a symbol name that neither platform ships fails
 * the build instead of rendering as a hole in the picker.
 */
const group = (
  title: string,
  icons: [key: string, label: string, ios: SFSymbol, material: AndroidSymbol][]
): IconGroup => ({
  title,
  icons: icons.map(([key, label, ios, material]) => ({ key, label, ios, material })),
});

export const IconGroups: IconGroup[] = [
  group('Everyday', [
    ['cart', 'Trolley', 'cart.fill', 'shopping_cart'],
    ['basket', 'Basket', 'basket.fill', 'shopping_basket'],
    ['bag', 'Shopping bag', 'bag.fill', 'shopping_bag'],
    ['tag', 'Tag', 'tag.fill', 'sell'],
    ['gift', 'Gift', 'gift.fill', 'redeem'],
    ['tshirt', 'Clothes', 'tshirt.fill', 'checkroom'],
  ]),
  group('Food and drink', [
    ['fork.knife', 'Restaurant', 'fork.knife', 'restaurant'],
    ['cup.and.saucer', 'Coffee', 'cup.and.saucer.fill', 'local_cafe'],
    ['takeout', 'Takeaway', 'takeoutbag.and.cup.and.straw.fill', 'takeout_dining'],
    ['wineglass', 'Drinks', 'wineglass.fill', 'wine_bar'],
    ['birthday.cake', 'Cake', 'birthday.cake.fill', 'cake'],
  ]),
  group('Getting around', [
    ['car', 'Car', 'car.fill', 'directions_car'],
    ['bus', 'Bus', 'bus.fill', 'directions_bus'],
    ['bicycle', 'Bicycle', 'bicycle', 'directions_bike'],
    ['airplane', 'Flight', 'airplane', 'flight'],
    ['fuelpump', 'Fuel', 'fuelpump.fill', 'local_gas_station'],
    ['parkingsign', 'Parking', 'parkingsign', 'local_parking'],
  ]),
  group('Home and bills', [
    ['house', 'Home', 'house.fill', 'home'],
    ['bolt', 'Electricity', 'bolt.fill', 'bolt'],
    ['flame', 'Gas', 'flame.fill', 'local_fire_department'],
    ['drop', 'Water', 'drop.fill', 'water_drop'],
    ['wifi', 'Internet', 'wifi', 'wifi'],
    ['key', 'Rent', 'key.fill', 'key'],
    ['hammer', 'Repairs', 'hammer.fill', 'handyman'],
    ['iphone', 'Phone', 'iphone', 'smartphone'],
  ]),
  group('Health and care', [
    ['heart', 'Heart', 'heart.fill', 'favorite'],
    ['cross.case', 'Medical', 'cross.case.fill', 'medical_services'],
    ['pills', 'Pharmacy', 'pills.fill', 'medication'],
    ['dumbbell', 'Fitness', 'dumbbell.fill', 'fitness_center'],
    ['scissors', 'Haircut', 'scissors', 'content_cut'],
    ['pawprint', 'Pets', 'pawprint.fill', 'pets'],
  ]),
  group('Fun and learning', [
    ['sparkles', 'Treats', 'sparkles', 'auto_awesome'],
    ['gamecontroller', 'Games', 'gamecontroller.fill', 'sports_esports'],
    ['film', 'Film', 'film.fill', 'movie'],
    ['music.note', 'Music', 'music.note', 'music_note'],
    ['book', 'Books', 'book.fill', 'menu_book'],
    ['graduationcap', 'Study', 'graduationcap.fill', 'school'],
    ['ticket', 'Tickets', 'ticket.fill', 'local_activity'],
    ['camera', 'Photography', 'camera.fill', 'photo_camera'],
  ]),
  group('Money and work', [
    ['creditcard', 'Card', 'creditcard.fill', 'credit_card'],
    ['building.columns', 'Bank', 'building.columns.fill', 'account_balance'],
    ['chart.line.uptrend', 'Investing', 'chart.line.uptrend.xyaxis', 'trending_up'],
    ['briefcase', 'Work', 'briefcase.fill', 'work'],
    ['shield', 'Insurance', 'shield.fill', 'shield'],
  ]),
  group('People and places', [
    ['person.2', 'People', 'person.2.fill', 'group'],
    ['bed.double', 'Stays', 'bed.double.fill', 'hotel'],
    ['globe', 'Travel', 'globe', 'public'],
    ['leaf', 'Green', 'leaf.fill', 'eco'],
    ['star', 'Favourite', 'star.fill', 'star'],
  ]),
];

/**
 * Glyphs the app owns rather than the user: they name a *kind of row*, not a
 * category, so they are deliberately outside {@link IconGroups} and can never
 * be picked.
 */
export const SystemSymbols = {
  income: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
} as const;

const BY_KEY = new Map<string, IconSpec>(
  IconGroups.flatMap((entry) => entry.icons).map((icon) => [icon.key, icon])
);

/** What a category gets when it is created without a choice. */
export const DefaultIconKey = 'tag';

export function findIcon(key: string | null | undefined): IconSpec | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * The per-platform names {@link import('expo-symbols').SymbolView} wants.
 *
 * Unknown keys resolve to the generic tag rather than to nothing: a row written
 * by a newer build of the app should render *something* on an older one.
 */
export function symbolFor(key: string | null | undefined) {
  const icon = findIcon(key) ?? BY_KEY.get(DefaultIconKey)!;
  return { ios: icon.ios, android: icon.material, web: icon.material };
}
