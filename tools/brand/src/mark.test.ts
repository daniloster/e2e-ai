import { describe, expect, it } from 'vitest';

import { BRAND_MARK, MONOCHROME_MARK, markBounds, polygon } from './mark';

describe('BRAND_MARK', () => {
  it('paints the crown, the pavilion, then the sparkle on top', () => {
    expect(BRAND_MARK.map((s) => s.role)).toEqual([
      'facetLight',
      'table',
      'facetMid',
      'facetMid',
      'facetLight',
      'facetDark',
      'sparkle',
    ]);
  });

  it('stays inside the design box and uses only absolute M L H V C Q Z', () => {
    const b = markBounds(BRAND_MARK);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(120);
    expect(b.maxY).toBeLessThanOrEqual(120);
    for (const s of [...BRAND_MARK, ...MONOCHROME_MARK]) expect(s.d).toMatch(/^[MLHVCQZ\d .-]+$/);
  });

  it('keeps the single-colour mark inside the full mark', () => {
    expect(markBounds(MONOCHROME_MARK)).toEqual(markBounds(BRAND_MARK));
  });

  it('is frozen', () => {
    expect(Object.isFrozen(BRAND_MARK)).toBe(true);
    expect(Object.isFrozen(BRAND_MARK[0])).toBe(true);
    expect(Object.isFrozen(MONOCHROME_MARK)).toBe(true);
  });
});

describe('polygon', () => {
  it('writes closed absolute path data with at most two decimals', () => {
    expect(
      polygon([
        [0, 0],
        [10.126, 5],
        [3, 4],
      ]),
    ).toBe('M0 0 L10.13 5 L3 4 Z');
    expect(() => polygon([])).toThrow(RangeError);
  });
});

describe('markBounds', () => {
  it('tracks the current point through H and V', () => {
    expect(markBounds([{ role: 'table', d: 'M10 20 H30 V40 Z' }])).toEqual({
      minX: 10,
      minY: 20,
      maxX: 30,
      maxY: 40,
    });
  });

  it('counts control points', () => {
    expect(markBounds([{ role: 'table', d: 'M0 0 Q50 -10 100 0' }]).minY).toBe(-10);
  });

  it('throws on no shapes, relative commands, arcs and missing operands', () => {
    expect(() => markBounds([])).toThrow(RangeError);
    expect(() => markBounds([{ role: 'table', d: 'M0 0 l10 10' }])).toThrow(/"l"/);
    expect(() => markBounds([{ role: 'table', d: 'M0 0 A5 5 0 0 1 10 10' }])).toThrow(/"A"/);
    expect(() => markBounds([{ role: 'table', d: 'M0 0 L10' }])).toThrow(RangeError);
    expect(() => markBounds([{ role: 'table', d: '10 10' }])).toThrow(RangeError);
  });
});
