import { describe, expect, it } from 'vitest';

import {
  CIRCLE_FIT,
  CORNER_FIT,
  RIBBON_COLOURS,
  ribbonPaths,
  ribbonSvg,
  withRibbonSvg,
  withRibbonVector,
} from './devRibbon';

/** Every coordinate pair in path data. */
function points(d: string): [number, number][] {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
  return out;
}

describe('dev ribbon', () => {
  it('keeps the letters inside a launcher circle and in the top-right quarter', () => {
    // An adaptive layer: 120-unit viewport, 80 units visible (72 of 108 dp).
    const { letters } = ribbonPaths(120, 80, CIRCLE_FIT);
    for (const [x, y] of points(letters)) {
      expect(Math.hypot(x - 60, y - 60)).toBeLessThan(40);
      expect(x).toBeGreaterThan(60);
      expect(y).toBeLessThan(60);
    }
  });

  it('keeps the letters on a square icon', () => {
    const { letters } = ribbonPaths(1024, 1024, CORNER_FIT);
    for (const [x, y] of points(letters)) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1024);
      expect(y).toBeGreaterThan(0);
    }
  });

  it('is deterministic and rejects a visible area larger than the canvas', () => {
    expect(ribbonPaths(48, 48, CORNER_FIT)).toEqual(ribbonPaths(48, 48, CORNER_FIT));
    expect(() => ribbonPaths(48, 60, CORNER_FIT)).toThrow(RangeError);
  });

  it('draws on top of a finished SVG and VectorDrawable', () => {
    const svg = withRibbonSvg(
      '<svg></svg>',
      ribbonSvg(48, 48, CIRCLE_FIT, RIBBON_COLOURS.colour, true),
    );
    expect(svg).toMatch(/<clipPath id="dev-ribbon-clip">.*<\/g><\/svg>$/);
    const xml = withRibbonVector('<vector>\n</vector>\n', 120, 80, CIRCLE_FIT, {
      band: '#FFFFFF',
      ink: null,
    });
    expect(xml).toContain('android:fillType="evenOdd"');
    expect(xml.endsWith('</vector>\n')).toBe(true);
    expect(() => withRibbonSvg('<svg>', '')).toThrow();
  });
});
