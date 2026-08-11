/**
 * Artwork for the onboarding explainer steps.
 *
 * Drawn in SVG from the app's own palette rather than shipped as illustration
 * assets: these stay sharp at any size, re-colour correctly in dark mode, and
 * can't drift out of sync with the interface they're describing — a stock
 * illustration of a form would start lying the moment the form changed.
 *
 * Both scenes are miniatures of real screens, not metaphors. The first is the
 * entry card feeding the donut; the second is the two-axis model.
 */

import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { CategoricalPalette, ChartInk } from '@/constants/palette';
import { useScheme } from '@/hooks/use-scheme';

const WIDTH = 260;
const HEIGHT = 180;

/** Step 1 — an amount goes in, the chart moves. */
export function LogItArt() {
  const scheme = useScheme();
  const ink = ChartInk[scheme];
  const palette = CategoricalPalette[scheme];

  return (
    <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {/* The entry card */}
      <Rect x={4} y={18} width={132} height={144} rx={16} fill={ink.surface} />

      {/* Amount field, with the figure represented as a heavy bar */}
      <Rect x={18} y={36} width={40} height={7} rx={3.5} fill={ink.muted} opacity={0.55} />
      <Rect x={18} y={50} width={104} height={30} rx={9} fill={ink.track} />
      <Rect x={28} y={60} width={54} height={11} rx={5.5} fill={palette[0]} />

      {/* Chip rows — category, then budget */}
      <Rect x={18} y={92} width={44} height={16} rx={8} fill={palette[2]} opacity={0.85} />
      <Rect x={68} y={92} width={34} height={16} rx={8} fill={ink.track} />
      <Rect x={18} y={116} width={34} height={16} rx={8} fill={palette[1]} opacity={0.85} />
      <Rect x={58} y={116} width={44} height={16} rx={8} fill={ink.track} />

      {/* Submit */}
      <Rect x={18} y={140} width={104} height={12} rx={6} fill={ink.muted} opacity={0.4} />

      {/* Flow arrow */}
      <Path
        d={`M 146 90 L 172 90`}
        stroke={ink.muted}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d={`M 166 84 L 173 90 L 166 96`}
        stroke={ink.muted}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* The donut it feeds, drawn as arcs with the same 2px surface gaps the
          real chart uses. */}
      <G>
        <Circle
          cx={212}
          cy={90}
          r={34}
          stroke={palette[0]}
          strokeWidth={17}
          fill="none"
          strokeDasharray="110 104"
          strokeDashoffset={0}
          transform="rotate(-90 212 90)"
        />
        <Circle
          cx={212}
          cy={90}
          r={34}
          stroke={palette[2]}
          strokeWidth={17}
          fill="none"
          strokeDasharray="60 154"
          strokeDashoffset={-114}
          transform="rotate(-90 212 90)"
        />
        <Circle
          cx={212}
          cy={90}
          r={34}
          stroke={palette[3]}
          strokeWidth={17}
          fill="none"
          strokeDasharray="36 178"
          strokeDashoffset={-178}
          transform="rotate(-90 212 90)"
        />
      </G>
    </Svg>
  );
}

/** Step 2 — one expense, answered on two independent axes. */
export function TwoAxesArt() {
  const scheme = useScheme();
  const ink = ChartInk[scheme];
  const palette = CategoricalPalette[scheme];

  return (
    <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {/* The expense at the centre */}
      <Rect x={92} y={78} width={76} height={26} rx={13} fill={ink.surface} />
      <Rect x={104} y={87} width={52} height={8} rx={4} fill={ink.muted} opacity={0.75} />

      {/* Connectors out to each axis */}
      <Path d="M 130 78 L 130 56" stroke={ink.muted} strokeWidth={2} strokeLinecap="round" />
      <Path d="M 130 104 L 130 126" stroke={ink.muted} strokeWidth={2} strokeLinecap="round" />

      {/* Upper axis: the pot it came from */}
      <Rect x={70} y={22} width={120} height={34} rx={12} fill={ink.surface} />
      <Path
        d="M 86 33 h 18 a 4 4 0 0 1 4 4 v 8 a 4 4 0 0 1 -4 4 h -18 a 4 4 0 0 1 -4 -4 v -8 a 4 4 0 0 1 4 -4 z"
        fill={palette[0]}
      />
      <Rect x={116} y={35} width={58} height={8} rx={4} fill={ink.muted} opacity={0.6} />
      <Rect x={116} y={47} width={36} height={5} rx={2.5} fill={ink.muted} opacity={0.35} />

      {/* Lower axis: what it was for */}
      <Rect x={70} y={126} width={120} height={34} rx={12} fill={ink.surface} />
      <Circle cx={95} cy={143} r={10} fill={palette[2]} />
      <Rect x={116} y={135} width={58} height={8} rx={4} fill={ink.muted} opacity={0.6} />
      <Rect x={116} y={147} width={44} height={5} rx={2.5} fill={ink.muted} opacity={0.35} />
    </Svg>
  );
}
