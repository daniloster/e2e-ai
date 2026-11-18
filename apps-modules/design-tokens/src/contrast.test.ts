import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast';

describe('contrast', () => {
  it('spans 1 to 21 whichever argument is lighter', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('reads either case and gives the WCAG luminance', () => {
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFCC33')).toBe(relativeLuminance('#ffcc33'));
    expect(Math.abs(contrastRatio('#ffffff', '#777777') - 4.48)).toBeLessThan(0.01);
  });

  it.each(['#fff', 'ffffff', '#gggggg', ''])('rejects %j', (bad) => {
    expect(() => relativeLuminance(bad)).toThrow(RangeError);
  });

  it('rejects a named colour', () => {
    expect(() => contrastRatio('#ffffff', 'red')).toThrow(RangeError);
  });
});
