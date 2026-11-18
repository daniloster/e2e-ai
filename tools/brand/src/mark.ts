// The Pocket Notes mark as data: a cut gem (table, two crown facets, three pavilion facets) with a
// four-point sparkle, in a 120x120 design box. Paths use absolute M L H V C Q Z only, so they are
// also valid VectorDrawable pathData. Replace the points below to rebrand; every target follows.
import type { Bounds, MarkShape } from './types';

/** Numbers in path data: at most 2 decimals, no trailing zeros. */
function n(value: number): string {
  return Number(value.toFixed(2)).toString();
}

type Point = readonly [number, number];

/** A closed polygon as absolute path data. */
export function polygon(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (first === undefined) throw new RangeError('polygon needs at least one point');
  return [`M${n(first[0])} ${n(first[1])}`, ...rest.map(([x, y]) => `L${n(x)} ${n(y)}`), 'Z'].join(
    ' ',
  );
}

// The gem: the table (top facet) from y 30, the girdle (widest line) at y 52, the culet at y 108.
const TABLE_TOP = 30;
const GIRDLE = 52;
const CULET: Point = [60, 108];
const LEFT: Point = [14, GIRDLE];
const RIGHT: Point = [106, GIRDLE];
const TABLE_LEFT: Point = [38, TABLE_TOP];
const TABLE_RIGHT: Point = [82, TABLE_TOP];
const INNER_LEFT: Point = [48, GIRDLE];
const INNER_RIGHT: Point = [72, GIRDLE];

const TABLE: readonly Point[] = [TABLE_LEFT, TABLE_RIGHT, INNER_RIGHT, INNER_LEFT];
const CROWN_LEFT: readonly Point[] = [LEFT, TABLE_LEFT, INNER_LEFT];
const CROWN_RIGHT: readonly Point[] = [TABLE_RIGHT, RIGHT, INNER_RIGHT];
const PAVILION_LEFT: readonly Point[] = [LEFT, INNER_LEFT, CULET];
const PAVILION_CENTRE: readonly Point[] = [INNER_LEFT, INNER_RIGHT, CULET];
const PAVILION_RIGHT: readonly Point[] = [INNER_RIGHT, RIGHT, CULET];
const SILHOUETTE: readonly Point[] = [LEFT, TABLE_LEFT, TABLE_RIGHT, RIGHT, CULET];

/** A four-point star centred on (cx, cy). */
function sparkle(cx: number, cy: number, outer: number, inner: number): readonly Point[] {
  return [
    [cx, cy - outer],
    [cx + inner, cy - inner],
    [cx + outer, cy],
    [cx + inner, cy + inner],
    [cx, cy + outer],
    [cx - inner, cy + inner],
    [cx - outer, cy],
    [cx - inner, cy - inner],
  ];
}
const SPARKLE = sparkle(100, 20, 11, 2.6);

/** Paint order: crown, pavilion, then the sparkle on top. */
export const BRAND_MARK: readonly MarkShape[] = Object.freeze(
  [
    { role: 'facetLight', d: polygon(CROWN_LEFT) },
    { role: 'table', d: polygon(TABLE) },
    { role: 'facetMid', d: polygon(CROWN_RIGHT) },
    { role: 'facetMid', d: polygon(PAVILION_LEFT) },
    { role: 'facetLight', d: polygon(PAVILION_CENTRE) },
    { role: 'facetDark', d: polygon(PAVILION_RIGHT) },
    { role: 'sparkle', d: polygon(SPARKLE) },
  ].map((shape) => Object.freeze(shape as MarkShape)),
);

/**
 * The mark for the single-colour Android themed icon: facets that differ only by colour would
 * merge, so the gem is one silhouette with an inset table and pavilion facet cut out (even-odd).
 */
export const MONOCHROME_MARK: readonly MarkShape[] = Object.freeze(
  [
    {
      role: 'facetMid',
      d: [
        polygon(SILHOUETTE),
        polygon([
          [43, 34],
          [77, 34],
          [69.5, 48],
          [50.5, 48],
        ]),
        polygon([
          [52, 57],
          [68, 57],
          [60, 95],
        ]),
      ].join(' '),
      fillRule: 'evenodd',
    },
    { role: 'sparkle', d: polygon(SPARKLE) },
  ].map((shape) => Object.freeze(shape as MarkShape)),
);

const TOKEN = /[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;
const OPERANDS: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };

/** Conservative bounds of every coordinate (control points included) in the design box. */
export function markBounds(shapes: readonly MarkShape[]): Bounds {
  if (shapes.length === 0) throw new RangeError('markBounds needs at least one shape');
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number): void => {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const shape of shapes) {
    const tokens = shape.d.match(TOKEN) ?? [];
    let x = 0;
    let y = 0;
    let i = 0;
    let command = '';
    while (i < tokens.length) {
      const token = tokens[i] ?? '';
      if (/[A-Za-z]/.test(token)) {
        if (!(token in OPERANDS)) throw new RangeError(`unsupported path command "${token}"`);
        command = token;
        i += 1;
        if (command === 'Z') continue;
      } else if (command === '' || command === 'Z') {
        throw new RangeError(`path data starts with a number: "${shape.d}"`);
      }
      const count = OPERANDS[command] ?? 0;
      const args = tokens.slice(i, i + count).map(Number);
      if (args.length !== count || args.some((v) => !Number.isFinite(v))) {
        throw new RangeError(`missing operand for "${command}" in "${shape.d}"`);
      }
      i += count;
      if (command === 'H') x = args[0] ?? x;
      else if (command === 'V') y = args[0] ?? y;
      else {
        for (let k = 0; k < count; k += 2) add(args[k] ?? 0, args[k + 1] ?? 0);
        x = args[count - 2] ?? x;
        y = args[count - 1] ?? y;
      }
      add(x, y);
    }
  }
  return b;
}
