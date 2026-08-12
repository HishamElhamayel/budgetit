/**
 * A category's icon, and the tinted disc it usually sits in.
 *
 * Drawn with `expo-symbols`, which resolves to SF Symbols on iOS and Material
 * Symbols on Android and web — so the app gets a full icon vocabulary without
 * an icon font, a native build, or the 400kb of SVG paths that hand-drawing
 * forty glyphs would cost. The per-platform names come from constants/icons.ts.
 *
 * The disc is what makes an icon *identity* rather than decoration: the glyph
 * is drawn in the entity's palette colour on a low-opacity wash of the same
 * colour, so a row carries both signals in one mark and neither has to work
 * alone. That matters here more than in most apps — see the ΔE floor in
 * constants/palette.ts, which is exactly why colour is never the only cue.
 */

import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { symbolFor } from '@/constants/icons';
import { withAlpha } from '@/constants/palette';

/** Fraction of the disc the glyph occupies. Below ~0.55 the icon looks lost. */
const GLYPH_RATIO = 0.58;

/** A platform symbol triple, as `expo-symbols` wants it. */
export type SymbolName = ComponentProps<typeof SymbolView>['name'];

export function Glyph({
  icon,
  symbol,
  size = 18,
  color,
}: {
  /** Category icon key, resolved through constants/icons.ts. */
  icon?: string | null;
  /** An app-owned symbol instead of a category's — see `SystemSymbols`. */
  symbol?: SymbolName;
  size?: number;
  color: string;
}) {
  return <SymbolView name={symbol ?? symbolFor(icon)} size={size} tintColor={color} />;
}

export function GlyphDisc({
  icon,
  symbol,
  color,
  size = 34,
  style,
}: {
  icon?: string | null;
  symbol?: SymbolName;
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 3,
          backgroundColor: withAlpha(color, 0.16),
        },
        style,
      ]}>
      <Glyph icon={icon} symbol={symbol} size={Math.round(size * GLYPH_RATIO)} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
