import { UI_COLORS } from '@pn/design-tokens';
import { describe, expect, it } from 'vitest';

import { paletteFor } from './palettes';
import { SPLASH_CONSTANTS } from './splashConstants';

describe('SPLASH_CONSTANTS', () => {
  it('takes the grounds from the splash palettes', () => {
    expect(SPLASH_CONSTANTS).toEqual({
      logoWidthDp: 128,
      background: { light: UI_COLORS.bg, dark: UI_COLORS.bg },
    });
    expect(SPLASH_CONSTANTS.background.light).toBe(paletteFor('splashLight').ground);
    expect(SPLASH_CONSTANTS.background.dark).toBe(paletteFor('splashDark').ground);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SPLASH_CONSTANTS)).toBe(true);
    expect(Object.isFrozen(SPLASH_CONSTANTS.background)).toBe(true);
  });
});
