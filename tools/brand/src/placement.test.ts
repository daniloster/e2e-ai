import { describe, expect, it } from 'vitest';

import { BRAND_MARK, markBounds } from './mark';
import { OUTLINE_WIDTH } from './palettes';
import { fitsCircle, placementFor } from './placement';

const bounds = markBounds(BRAND_MARK);
const pad = OUTLINE_WIDTH / 2;
const padded = {
  minX: bounds.minX - pad,
  minY: bounds.minY - pad,
  maxX: bounds.maxX + pad,
  maxY: bounds.maxY + pad,
};

describe('placementFor', () => {
  it('fits the adaptive and monochrome layers inside the 66 dp safe zone', () => {
    for (const v of ['adaptiveFg', 'monochrome'] as const) {
      expect(fitsCircle(bounds, placementFor(v, 108), 66)).toBe(true);
      expect(fitsCircle(padded, placementFor(v, 108), 66)).toBe(true);
    }
  });

  it('fits both splash logos inside the 192 dp splash circle', () => {
    for (const v of ['splashLight', 'splashDark'] as const) {
      expect(fitsCircle(padded, placementFor(v, 288), 192)).toBe(true);
    }
  });

  it('uses the largest size that fits', () => {
    const p = placementFor('adaptiveFg', 108);
    expect(fitsCircle(padded, { ...p, markSize: p.markSize + 1 }, 66)).toBe(false);
  });

  it('fills 80 % of the canvas for the iOS and legacy icons', () => {
    for (const v of ['any', 'dark', 'tinted'] as const) {
      expect(placementFor(v, 1024)).toEqual({ canvas: 1024, markSize: 819.2 });
    }
  });

  it('can fail the safe-zone check: the 80 % icon size is too big for it', () => {
    expect(fitsCircle(bounds, placementFor('any', 108), 66)).toBe(false);
  });

  it('throws on a canvas that is not a positive number', () => {
    for (const bad of [0, -1, Number.NaN])
      expect(() => placementFor('any', bad)).toThrow(RangeError);
  });
});

describe('fitsCircle', () => {
  it('compares the corners with the circle', () => {
    const box = { minX: 0, minY: 0, maxX: 120, maxY: 120 };
    expect(fitsCircle(box, { canvas: 120, markSize: 120 }, 120 * Math.SQRT2)).toBe(true);
    expect(fitsCircle(box, { canvas: 120, markSize: 120 }, 169)).toBe(false);
  });
});
