// The "DEV" ribbon that marks debug builds' app icons (iOS Debug configuration, Android debug
// build type), so a development install never passes for the store app. A diagonal band across
// the top-right corner in the danger colour with "DEV" in block letters. The letters are path data (no
// fonts), so resvg and Android VectorDrawable draw the same shapes, and the output is
// deterministic.
import { UI_COLORS } from '@pn/design-tokens';

/** Where the ribbon sits, in units of the side of the area the user actually sees. */
export interface RibbonFit {
  /** Distance from the visible centre to the ribbon's centre line, along the top-right diagonal. */
  reach: number;
  /** Band thickness. */
  thickness: number;
}

/** A square icon (iOS, Android legacy): the classic corner sash. */
export const CORNER_FIT: RibbonFit = Object.freeze({ reach: 0.35, thickness: 0.17 });
/** A circle-masked icon (Android adaptive and round): pulled in so the letters stay in the circle. */
export const CIRCLE_FIT: RibbonFit = Object.freeze({ reach: 0.31, thickness: 0.15 });

export interface RibbonColours {
  band: string;
  /** null = the letters are cut out of the band (single-colour layers). */
  ink: string | null;
}

export const RIBBON_COLOURS: Readonly<Record<'colour' | 'tinted', RibbonColours>> = Object.freeze({
  colour: Object.freeze({ band: UI_COLORS.danger, ink: '#FFFFFF' }),
  // iOS tints a grayscale icon: light band, dark letters.
  tinted: Object.freeze({ band: '#E6E6E6', ink: '#1A1A1A' }),
});

type Pt = readonly [number, number];

/** Block letters on a 4x5 grid; D's counter is its second sub-path (even-odd). */
const GLYPHS: readonly (readonly Pt[])[][] = [
  [
    [
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 4],
      [3, 5],
      [0, 5],
    ],
    [
      [1.2, 1.1],
      [2.6, 1.1],
      [2.9, 1.4],
      [2.9, 3.6],
      [2.6, 3.9],
      [1.2, 3.9],
    ],
  ],
  [
    [
      [0, 0],
      [4, 0],
      [4, 1.1],
      [1.2, 1.1],
      [1.2, 1.95],
      [3.4, 1.95],
      [3.4, 3.05],
      [1.2, 3.05],
      [1.2, 3.9],
      [4, 3.9],
      [4, 5],
      [0, 5],
    ],
  ],
  [
    [
      [0, 0],
      [1.25, 0],
      [2, 3.4],
      [2.75, 0],
      [4, 0],
      [2.65, 5],
      [1.35, 5],
    ],
  ],
];
const GLYPH_W = 4;
const GLYPH_H = 5;
const GAP = 1;
const TEXT_W = GLYPHS.length * GLYPH_W + (GLYPHS.length - 1) * GAP;
/** Letter height as a share of the band thickness. */
const TEXT_SHARE = 0.5;

function num(n: number): string {
  return Number(n.toFixed(4)).toString();
}
function polygon(points: readonly Pt[]): string {
  return `M${points.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')} Z`;
}

/**
 * The band and the letters as path data in a `canvas`-unit square whose visible part is the
 * centred square of side `visible` (the whole canvas for iOS, 72 of 108 for an adaptive layer).
 */
export function ribbonPaths(
  canvas: number,
  visible: number,
  fit: RibbonFit,
): { band: string; letters: string } {
  if (![canvas, visible].every((v) => Number.isFinite(v) && v > 0) || visible > canvas) {
    throw new RangeError('ribbonPaths needs 0 < visible <= canvas');
  }
  const c = Math.SQRT1_2;
  const mid = canvas / 2;
  const reach = fit.reach * visible;
  // Ribbon centre on the top-right diagonal (y grows downwards).
  const cx = mid + reach * c;
  const cy = mid - reach * c;
  // Local axes: u runs along the band (down-right), v across it (down-left).
  const at = (u: number, v: number): Pt => [cx + (u - v) * c, cy + (u + v) * c];
  const half = (fit.thickness * visible) / 2;
  const long = canvas; // longer than the canvas diagonal from the centre: the edges clip it
  const band = polygon([at(-long, -half), at(long, -half), at(long, half), at(-long, half)]);
  const unit = (fit.thickness * visible * TEXT_SHARE) / GLYPH_H;
  const u0 = (-TEXT_W * unit) / 2;
  const v0 = (-GLYPH_H * unit) / 2;
  const letters = GLYPHS.flatMap((glyph, i) =>
    glyph.map((sub) =>
      polygon(sub.map(([x, y]) => at(u0 + (i * (GLYPH_W + GAP) + x) * unit, v0 + y * unit))),
    ),
  ).join(' ');
  return { band, letters };
}

/** The ribbon as SVG elements for a `canvas`-px document; `clipCircle` keeps it inside a round icon. */
export function ribbonSvg(
  canvas: number,
  visible: number,
  fit: RibbonFit,
  colours: RibbonColours,
  clipCircle = false,
): string {
  const { band, letters } = ribbonPaths(canvas, visible, fit);
  const r = num(canvas / 2);
  const clip = clipCircle
    ? `<clipPath id="dev-ribbon-clip"><circle cx="${r}" cy="${r}" r="${r}"/></clipPath>`
    : '';
  const open = clipCircle ? '<g clip-path="url(#dev-ribbon-clip)">' : '<g>';
  const body =
    colours.ink === null
      ? `<path d="${band} ${letters}" fill="${colours.band}" fill-rule="evenodd"/>`
      : `<path d="${band}" fill="${colours.band}"/><path d="${letters}" fill="${colours.ink}" fill-rule="evenodd"/>`;
  return `${clip}${open}${body}</g>`;
}

/** Adds the ribbon on top of a finished SVG document. */
export function withRibbonSvg(svg: string, ribbon: string): string {
  if (!svg.endsWith('</svg>')) throw new Error('expected a complete SVG document');
  return `${svg.slice(0, -'</svg>'.length)}${ribbon}</svg>`;
}

/** Adds the ribbon on top of a VectorDrawable whose viewport is `viewport` units square. */
export function withRibbonVector(
  xml: string,
  viewport: number,
  visible: number,
  fit: RibbonFit,
  colours: RibbonColours,
): string {
  const close = '</vector>\n';
  if (!xml.endsWith(close)) throw new Error('expected a complete <vector> document');
  const { band, letters } = ribbonPaths(viewport, visible, fit);
  const paths =
    colours.ink === null
      ? [
          `  <path android:pathData="${band} ${letters}" android:fillColor="${colours.band}" android:fillType="evenOdd"/>`,
        ]
      : [
          `  <path android:pathData="${band}" android:fillColor="${colours.band}"/>`,
          `  <path android:pathData="${letters}" android:fillColor="${colours.ink}" android:fillType="evenOdd"/>`,
        ];
  return `${xml.slice(0, -close.length)}${paths.join('\n')}\n${close}`;
}
