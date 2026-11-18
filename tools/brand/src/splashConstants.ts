// The splash logo width and the two grounds. The app is dark-only, so both appearances use the
// UI background; the light/dark split stays so either can change on its own.
import { UI_COLORS } from '@pn/design-tokens';

import type { SplashConstants } from './types';

export const SPLASH_CONSTANTS: SplashConstants = Object.freeze({
  logoWidthDp: 128,
  background: Object.freeze({ light: UI_COLORS.bg, dark: UI_COLORS.bg }),
});
