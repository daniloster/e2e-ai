// A MarkDocument as an Android <vector> drawable. The viewport is the 120-unit design box standing
// for the whole canvas; a <group> transform reproduces toSvg's centred placement, so each shape's
// path data (absolute M L H V C Q Z) is emitted verbatim as pathData.
import type { MarkDocument, MarkShape, Palette } from './types';

export interface VectorOptions {
  /** Viewport and size in dp; the mark is placed per its MarkDocument.placement. */
  sizeDp: number;
}

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const COLOUR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const BOX = 120;

/** Same formatter as svg.ts: at most 4 decimals, no trailing zeros. */
function num(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function colour(hex: string): string {
  if (!COLOUR.test(hex)) throw new RangeError(`not a #rrggbb or #aarrggbb colour: "${hex}"`);
  return hex;
}

function shapePath(shape: MarkShape, fill: string, palette: Palette): string {
  const rule = shape.fillRule === 'evenodd' ? ' android:fillType="evenOdd"' : '';
  const stroke =
    palette.outline === null
      ? ''
      : ` android:strokeColor="${colour(palette.outline)}"` +
        ` android:strokeWidth="${num(palette.outlineWidth)}" android:strokeLineJoin="round"`;
  return `    <path android:pathData="${shape.d}" android:fillColor="${colour(fill)}"${rule}${stroke}/>`;
}

/** `<vector>` XML: viewport 120x120 mapped to sizeDp, a <group> for the placement transform, one <path> per shape. Deterministic. */
export function toVectorDrawable(doc: MarkDocument, options: VectorOptions): string {
  const { sizeDp } = options;
  if (!Number.isFinite(sizeDp) || sizeDp <= 0) {
    throw new RangeError(`sizeDp must be a positive number, got ${sizeDp}`);
  }
  const { palette, placement, shapes } = doc;
  const scale = placement.markSize / placement.canvas;
  const s = num(scale);
  const t = num((BOX / 2) * (1 - scale));
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<vector xmlns:android="${ANDROID_NS}" android:width="${num(sizeDp)}dp" ` +
      `android:height="${num(sizeDp)}dp" android:viewportWidth="${BOX}" android:viewportHeight="${BOX}">`,
    ...(palette.ground === null
      ? []
      : [
          `  <path android:pathData="M0 0 H120 V120 H0 Z" android:fillColor="${colour(palette.ground)}"/>`,
        ]),
    `  <group android:scaleX="${s}" android:scaleY="${s}" android:translateX="${t}" android:translateY="${t}">`,
    ...shapes.map((shape) => shapePath(shape, palette.fills[shape.role], palette)),
    '  </group>',
    '</vector>',
  ];
  return `${lines.join('\n')}\n`;
}
