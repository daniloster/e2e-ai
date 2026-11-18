// One palette per variant, every colour from @pn/design-tokens (or derived from a token here).
// Strategy: an exhaustive table indexed by the variant, never a branch on it, so a new variant
// fails to compile until it has a palette.
import { UI_COLORS } from '@pn/design-tokens';

import type { Palette, VariantId } from './types';

/** Outline width in design-box units. */
export const OUTLINE_WIDTH = 3;
/** Android tints the monochrome layer by alpha only, so any opaque colour works. */
const MONOCHROME = '#FFFFFF';

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new RangeError(`expected #rrggbb, got "${hex}"`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb
    .map((v) =>
      Math.min(255, Math.max(0, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** `hex` moved a share `t` (0..1) towards `towards`; both #rrggbb. */
export function mix(hex: string, towards: string, t: number): string {
  const a = channels(hex);
  const b = channels(towards);
  return toHex(a.map((v, i) => v + ((b[i] ?? v) - v) * t));
}

type Fills = Palette['fills'];

/** The gem in the primary colour, lit from the top left; the sparkle in ink. */
const FULL: Readonly<Fills> = Object.freeze({
  table: mix(UI_COLORS.primary, '#FFFFFF', 0.45),
  facetLight: mix(UI_COLORS.primary, '#FFFFFF', 0.18),
  facetMid: UI_COLORS.primary,
  facetDark: mix(UI_COLORS.primary, '#000000', 0.35),
  sparkle: UI_COLORS.ink,
});

function mapFills(fills: Readonly<Fills>, f: (hex: string) => string): Fills {
  return {
    table: f(fills.table),
    facetLight: f(fills.facetLight),
    facetMid: f(fills.facetMid),
    facetDark: f(fills.facetDark),
    sparkle: f(fills.sparkle),
  };
}

/** Facet edges drawn in the ground colour; on transparent grounds the hairline colour. */
function outlined(ground: string | null, outline: string = UI_COLORS.bg): Palette {
  return { ground, fills: { ...FULL }, outline, outlineWidth: OUTLINE_WIDTH };
}

function flat(fills: Fills): Palette {
  return { ground: null, fills, outline: null, outlineWidth: 0 };
}

const PALETTES: Readonly<Record<VariantId, () => Palette>> = Object.freeze({
  any: () => outlined(UI_COLORS.bg),
  dark: () => outlined(null, UI_COLORS.line),
  tinted: () => flat(mapFills(FULL, toGray)),
  monochrome: () => flat(mapFills(FULL, () => MONOCHROME)),
  adaptiveFg: () => outlined(null),
  // The app is dark-only: the light appearance gets the same dark-ground splash, so no light
  // frame flashes before the dark app.
  splashLight: () => outlined(UI_COLORS.bg, UI_COLORS.bg),
  splashDark: () => outlined(UI_COLORS.bg, UI_COLORS.bg),
});

/** A fresh palette for the variant; callers may mutate it freely. */
export function paletteFor(variant: VariantId): Palette {
  return PALETTES[variant]();
}

/** Rec. 709 luma of a #rrggbb colour mapped to a gray #rrggbb; used by 'tinted'. */
export function toGray(hex: string): string {
  const [r, g, b] = channels(hex);
  const v = Math.min(255, Math.max(0, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
  const digits = v.toString(16).padStart(2, '0');
  return `#${digits}${digits}${digits}`;
}
