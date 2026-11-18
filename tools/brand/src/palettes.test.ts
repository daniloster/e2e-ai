import { UI_COLORS } from '@pn/design-tokens';
import { describe, expect, it } from 'vitest';

import { mix, OUTLINE_WIDTH, paletteFor, toGray } from './palettes';
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
const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('paletteFor', () => {
  it('gives every variant a #rrggbb fill for every role', () => {
    for (const v of VARIANTS) {
      const p = paletteFor(v);
      for (const fill of Object.values(p.fills)) expect(fill, v).toMatch(HEX);
      if (p.ground !== null) expect(p.ground).toMatch(HEX);
      if (p.outline !== null) expect(p.outline).toMatch(HEX);
    }
  });

  it('puts only the App Store / legacy icon and the splash on an opaque ground', () => {
    expect(VARIANTS.filter((v) => paletteFor(v).ground !== null)).toEqual([
      'any',
      'splashLight',
      'splashDark',
    ]);
    expect(paletteFor('any').ground).toBe(UI_COLORS.bg);
  });

  it('draws the gem in the primary colour, outlined, except the flat variants', () => {
    expect(paletteFor('any').fills.facetMid).toBe(UI_COLORS.primary);
    expect(paletteFor('any').outlineWidth).toBe(OUTLINE_WIDTH);
    for (const v of ['tinted', 'monochrome'] as const) {
      expect(paletteFor(v)).toMatchObject({ outline: null, outlineWidth: 0 });
    }
  });

  it('grays the tinted variant and whitens the monochrome one', () => {
    for (const fill of Object.values(paletteFor('tinted').fills)) {
      expect(fill.slice(1, 3)).toBe(fill.slice(3, 5));
      expect(fill.slice(3, 5)).toBe(fill.slice(5, 7));
    }
    expect(new Set(Object.values(paletteFor('monochrome').fills))).toEqual(new Set(['#FFFFFF']));
  });

  it('returns a fresh object each time', () => {
    const a = paletteFor('any');
    a.fills.table = '#000000';
    expect(paletteFor('any').fills.table).not.toBe('#000000');
  });
});

describe('colour helpers', () => {
  it('mixes and grays #rrggbb colours', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#123456', '#FFFFFF', 0)).toBe('#123456');
    expect(toGray('#FFFFFF')).toBe('#ffffff');
    expect(toGray('#000000')).toBe('#000000');
    expect(() => toGray('red')).toThrow(RangeError);
    expect(() => mix('#fff', '#000000', 0.5)).toThrow(RangeError);
  });
});
