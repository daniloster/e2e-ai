import { UI_COLORS } from '@pn/design-tokens';
import { describe, expect, it } from 'vitest';

import { BRAND_MARK, MONOCHROME_MARK } from './mark';
import { renderPng } from './png';
import { decodeRgba } from './testing/decodeRgba';
import { markDocument, toSvg } from './svg';
import type { VariantId } from './types';

const VARIANTS: readonly VariantId[] = [
  'any',
  'dark',
  'tinted',
  'monochrome',
  'adaptiveFg',
  'splashLight',
  'splashDark',
];
const SHAPE =
  /^<svg [^>]*>(<rect [^<>]*\/>)?<g transform="translate\([\d.]+ [\d.]+\) scale\([\d.]+\)">(<path [^<>]*\/>)+<\/g><\/svg>$/;
const UNSAFE = ['<text', '<filter', '<image', '<style', '<script', 'href=', 'style='];
const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('toSvg', () => {
  it('is deterministic, well-shaped and safe for every variant and canvas', () => {
    for (const v of VARIANTS) {
      for (const c of [108, 288, 1024]) {
        const svg = toSvg(markDocument(v, c));
        expect(toSvg(markDocument(v, c))).toBe(svg);
        expect(svg).toMatch(SHAPE);
        expect(count(svg, '<path')).toBe(
          (v === 'monochrome' ? MONOCHROME_MARK : BRAND_MARK).length,
        );
        for (const token of UNSAFE) expect(svg).not.toContain(token);
      }
    }
  });

  it('draws a ground only for opaque variants', () => {
    expect(toSvg(markDocument('any', 1024))).toContain(
      `<rect width="1024" height="1024" fill="${UI_COLORS.bg}"/>`,
    );
    for (const v of ['dark', 'tinted', 'monochrome', 'adaptiveFg'] as const) {
      expect(toSvg(markDocument(v, 1024))).not.toContain('<rect');
    }
    for (const v of ['splashLight', 'splashDark'] as const) {
      expect(count(toSvg(markDocument(v, 288)), '<rect')).toBe(1);
    }
  });

  it('places the 120-unit box on the canvas', () => {
    const svg = toSvg(markDocument('any', 1024));
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
      ),
    ).toBe(true);
    expect(svg).toContain('translate(102.4 102.4) scale(6.8267)');
  });

  it('writes monochrome as white shapes with no stroke', () => {
    const svg = toSvg(markDocument('monochrome', 108));
    expect(svg).not.toContain('stroke=');
    expect(new Set(svg.match(/fill="[^"]*"/g))).toEqual(new Set(['fill="#FFFFFF"']));
  });

  it('reads the palette of the document it is given', () => {
    const doc = markDocument('any', 1024);
    const changed = {
      ...doc,
      palette: { ...doc.palette, fills: { ...doc.palette.fills, table: '#123456' } },
    };
    expect(toSvg(changed)).toContain('fill="#123456"');
  });

  it('rejects an invalid canvas', () => {
    expect(() => markDocument('splashDark', 0)).toThrow(RangeError);
  });
});

describe('the single-colour mark', () => {
  it('is the even-odd silhouette plus the sparkle', () => {
    expect(MONOCHROME_MARK.map((s) => s.role)).toEqual(['facetMid', 'sparkle']);
    expect(markDocument('monochrome', 108).shapes).toBe(MONOCHROME_MARK);
    expect(markDocument('adaptiveFg', 108).shapes).toBe(BRAND_MARK);
    expect(toSvg(markDocument('monochrome', 108)).match(/fill-rule="evenodd"/g)).toHaveLength(1);
  });

  it('leaves the inset facets as gaps you can see through', () => {
    const doc = markDocument('monochrome', 120);
    const image = decodeRgba(
      renderPng(toSvg({ ...doc, placement: { canvas: 120, markSize: 120 } }), 120),
    );
    const alpha = (x: number, y: number): number => image.data[(y * 120 + x) * 4 + 3] ?? -1;
    expect(alpha(60, 41)).toBe(0); // the table cut-out
    expect(alpha(60, 70)).toBe(0); // the pavilion cut-out
    expect(alpha(30, 52)).toBe(255); // the girdle
    expect(alpha(100, 20)).toBe(255); // the sparkle
    expect(alpha(5, 5)).toBe(0); // outside
  });
});
