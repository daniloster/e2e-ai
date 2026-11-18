// App-wide layout constants built on @pn/design-tokens: the token colours and fonts plus spacing,
// type styles and the minimum touch size.
import { FONTS, UI_COLORS } from '@pn/design-tokens';

export { FONTS, RADIUS, UI_COLORS } from '@pn/design-tokens';

/**
 * The font faces bundled in assets/fonts, by PostScript name (what React Native's fontFamily
 * needs): the token families plus their weights.
 */
export const FONT_FACES = {
  display: `${FONTS.display}-Regular`,
  body: `${FONTS.body}-Regular`,
  bodySemiBold: `${FONTS.body}-SemiBold`,
  bodyBold: `${FONTS.body}-Bold`,
} as const;

/** The smallest touch target (Apple HIG 44 pt; Material 48 dp is met with hitSlop where needed). */
export const MIN_TOUCH = 44;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const type = {
  display: {
    fontFamily: FONT_FACES.display,
    fontSize: 28,
    color: UI_COLORS.ink,
  },
  title: { fontFamily: FONT_FACES.display, fontSize: 20, color: UI_COLORS.ink },
  label: {
    fontFamily: FONT_FACES.bodySemiBold,
    fontSize: 13,
    letterSpacing: 1,
    color: UI_COLORS.muted,
  },
  body: { fontFamily: FONT_FACES.body, fontSize: 16, color: UI_COLORS.ink },
  button: { fontFamily: FONT_FACES.bodyBold, fontSize: 17, letterSpacing: 0.5 },
  mono: {
    fontFamily: FONT_FACES.bodySemiBold,
    fontSize: 16,
    color: UI_COLORS.ink,
  },
} as const;
