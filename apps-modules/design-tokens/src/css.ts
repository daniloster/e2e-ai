// The UI tokens as CSS custom properties, for the website's :root (and the legal pages' generated
// /site/tokens.css).
import { PALETTE } from './palette';
import type { UiColors } from './palette';

const COLOR_VARIABLES: Readonly<Record<keyof UiColors, `--color-${string}`>> = Object.freeze({
  bg: '--color-bg',
  surface: '--color-surface',
  ink: '--color-ink',
  muted: '--color-muted',
  primary: '--color-primary',
  primaryInk: '--color-primary-ink',
  secondary: '--color-secondary',
  line: '--color-line',
  danger: '--color-danger',
});

// A font family name as a CSS stack: the brand face first, then system fallbacks.
function fontStack(name: string, fallback: string): string {
  return `"${name}", ${fallback}`;
}

/** `--color-*` per UI colour, `--font-display` / `--font-body` and `--radius` in px. Frozen. */
export function cssVariables(): Readonly<Record<`--${string}`, string>> {
  const out: Record<`--${string}`, string> = {};
  for (const key of Object.keys(COLOR_VARIABLES) as (keyof UiColors)[]) {
    out[COLOR_VARIABLES[key]] = PALETTE.ui[key];
  }
  out['--font-display'] = fontStack(PALETTE.fonts.display, 'system-ui, sans-serif');
  out['--font-body'] = fontStack(
    PALETTE.fonts.body,
    'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  );
  out['--radius'] = `${PALETTE.radius}px`;
  return Object.freeze(out);
}
