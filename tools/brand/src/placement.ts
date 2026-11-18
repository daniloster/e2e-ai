// How big the mark is drawn on each output. The 120-unit design box is scaled to
// markSize and centred on the canvas. Launchers and the Android 12 splash keep only a centred
// circle, so those variants are sized to fit it; the outermost points decide the scale.
import { BRAND_MARK, markBounds } from './mark';
import { OUTLINE_WIDTH } from './palettes';
import type { Bounds, Placement, VariantId } from './types';

type Fit =
  | { kind: 'fill'; ratio: number } // markSize = canvas * ratio
  | { kind: 'circle'; ratio: number }; // circle diameter = canvas * ratio

const ICON: Fit = { kind: 'fill', ratio: 0.8 };
/** Adaptive icon: the inner 66 dp of the 108 dp layer survive every launcher mask. */
const SAFE_ZONE: Fit = { kind: 'circle', ratio: 66 / 108 };
/** Android 12 splash without an icon background: a 192 dp circle of the 288 dp icon. */
const SPLASH_CIRCLE: Fit = { kind: 'circle', ratio: 192 / 288 };

const FITS: Readonly<Record<VariantId, Fit>> = Object.freeze({
  any: ICON,
  dark: ICON,
  tinted: ICON,
  monochrome: SAFE_ZONE,
  adaptiveFg: SAFE_ZONE,
  splashLight: SPLASH_CIRCLE,
  splashDark: SPLASH_CIRCLE,
});

const BOX = 120;
const MID = BOX / 2;

/** The mark's bounds grown by half the outline, so the stroke stays inside too. */
function paddedBounds(): Bounds {
  const b = markBounds(BRAND_MARK);
  const pad = OUTLINE_WIDTH / 2;
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

function corners(b: Bounds): readonly (readonly [number, number])[] {
  return [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.minX, b.maxY],
    [b.maxX, b.maxY],
  ];
}

/** Farthest bounds corner from the design-box centre, which is what lands on the canvas centre. */
function farthestCornerRadius(b: Bounds): number {
  return Math.max(...corners(b).map(([x, y]) => Math.hypot(x - MID, y - MID)));
}

/** Mark size for a variant on a canvas: icons fill ~80 % of the canvas; adaptiveFg fits the 66/108 safe circle; splash variants fit the 192/288 splash circle. */
export function placementFor(variant: VariantId, canvas: number): Placement {
  if (!Number.isFinite(canvas) || canvas <= 0) {
    throw new RangeError(`canvas must be a positive number, got ${canvas}`);
  }
  const fit = FITS[variant];
  if (fit.kind === 'fill') return { canvas, markSize: canvas * fit.ratio };
  const radius = (canvas * fit.ratio) / 2;
  const markSize = Math.floor(((radius * BOX) / farthestCornerRadius(paddedBounds())) * 100) / 100;
  return { canvas, markSize };
}

/** True when the scaled mark bounds' diagonal fits a centred circle of `diameter`. */
export function fitsCircle(bounds: Bounds, placement: Placement, diameter: number): boolean {
  const { canvas, markSize } = placement;
  const offset = (canvas - markSize) / 2;
  const centre = canvas / 2;
  return corners(bounds).every(([x, y]) => {
    const cx = offset + (x * markSize) / BOX;
    const cy = offset + (y * markSize) / BOX;
    return Math.hypot(cx - centre, cy - centre) <= diameter / 2 + 1e-9;
  });
}
