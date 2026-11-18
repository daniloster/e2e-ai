import { UI_COLORS } from '@pn/design-tokens';
import { describe, expect, it } from 'vitest';

import { BRAND_MARK } from './mark';
import { markDocument, toSvg } from './svg';
import type { VariantId } from './types';
import { toVectorDrawable } from './vectorDrawable';

const VARIANTS: readonly VariantId[] = [
  'any',
  'dark',
  'tinted',
  'monochrome',
  'adaptiveFg',
  'splashLight',
  'splashDark',
];
const PATH = '    <path android:pathData="[MLHVCQZ\\d .-]+" [^<>]*/>';
const GRAMMAR = new RegExp(
  '^<\\?xml version="1\\.0" encoding="utf-8"\\?>\\n' +
    '<vector [^<>]*>\\n' +
    '(  <path [^<>]*/>\\n)?' +
    '  <group [^<>]*>\\n' +
    `(${PATH}\\n)+` +
    '  </group>\\n' +
    '</vector>\\n$',
);
const vd = (v: VariantId, canvas = 108): string =>
  toVectorDrawable(markDocument(v, canvas), { sizeDp: 108 });
const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('toVectorDrawable', () => {
  it('writes well-formed, deterministic XML with a 120 viewport for every variant', () => {
    for (const v of VARIANTS) {
      const xml = vd(v);
      expect(xml).toMatch(GRAMMAR);
      expect(xml).toBe(vd(v));
      expect(xml).toContain('android:viewportWidth="120" android:viewportHeight="120"');
      expect(xml).toContain('android:width="108dp" android:height="108dp"');
      for (const [, value] of xml.matchAll(/android:(?:fill|stroke)Color="([^"]*)"/g)) {
        expect(value).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i);
      }
    }
  });

  it('emits one outlined path per shape and no ground for the adaptive foreground', () => {
    const xml = vd('adaptiveFg');
    expect(count(xml, '<path')).toBe(BRAND_MARK.length);
    expect(count(xml, `android:strokeColor="${UI_COLORS.bg}" android:strokeWidth="3"`)).toBe(
      BRAND_MARK.length,
    );
  });

  it('adds a full-viewport ground when the palette has one', () => {
    const xml = vd('any');
    expect(count(xml, '<path')).toBe(BRAND_MARK.length + 1);
    expect(xml).toContain(
      `  <path android:pathData="M0 0 H120 V120 H0 Z" android:fillColor="${UI_COLORS.bg}"/>\n`,
    );
  });

  it('writes the monochrome layer in one colour with no stroke, cut-outs even-odd', () => {
    const xml = vd('monochrome');
    expect(new Set(xml.match(/android:fillColor="[^"]*"/g))).toEqual(
      new Set(['android:fillColor="#FFFFFF"']),
    );
    expect(xml).not.toContain('android:strokeColor');
    expect(xml.match(/android:fillType="evenOdd"/g)).toHaveLength(1);
    expect(vd('adaptiveFg')).not.toContain('android:fillType');
  });

  it('places the mark like toSvg does', () => {
    const xml = toVectorDrawable(markDocument('any', 1024), { sizeDp: 108 });
    expect(xml).toContain('android:scaleX="0.8" android:scaleY="0.8"');
    expect(xml).toContain('android:translateX="12" android:translateY="12"');
    expect(toSvg(markDocument('any', 1024))).toContain('translate(102.4 102.4)');
  });

  it('throws on a bad size or a colour it cannot write', () => {
    const doc = markDocument('any', 108);
    for (const sizeDp of [0, -1, Number.NaN]) {
      expect(() => toVectorDrawable(doc, { sizeDp })).toThrow(RangeError);
    }
    const red = {
      ...doc,
      palette: { ...doc.palette, fills: { ...doc.palette.fills, table: 'red' } },
    };
    expect(() => toVectorDrawable(red, { sizeDp: 108 })).toThrow(RangeError);
  });
});
