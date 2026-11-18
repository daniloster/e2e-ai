// Board palette: the single source of colour, type and radius tokens for the website, the mobile
// app and tools/brand (ARCHITECTURE.md §10). Slate surfaces with an amber primary.

export interface UiColors {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  /** Primary buttons and highlights (amber). */
  primary: string;
  /** Text and icons on `primary`. */
  primaryInk: string;
  /** Secondary accent (teal). */
  secondary: string;
  /** Hairlines, borders and dividers. */
  line: string;
  /** Errors and destructive actions. */
  danger: string;
}

export interface Fonts {
  display: string;
  body: string;
}

export interface Palette {
  ui: UiColors;
  fonts: Fonts;
  /** Corner radius in px (web) or points (mobile). */
  radius: number;
}

export const UI_COLORS: UiColors = Object.freeze({
  bg: '#14181F',
  surface: '#1F2530',
  ink: '#EEF1F5',
  muted: '#9AA4B2',
  primary: '#F2A93B',
  primaryInk: '#14181F',
  secondary: '#4FB8B0',
  line: '#313948',
  danger: '#F06A6A',
});

export const FONTS: Fonts = Object.freeze({ display: 'Bungee', body: 'Barlow' });

export const RADIUS = 8;

export const PALETTE: Palette = Object.freeze({ ui: UI_COLORS, fonts: FONTS, radius: RADIUS });
