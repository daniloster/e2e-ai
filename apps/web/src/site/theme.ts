// The site theme: the @pn/design-tokens UI tokens as one :root{...} block for the head <style>.
import { cssVariables } from '@pn/design-tokens';

// ':root{--color-bg:<hex>;...;--radius:<n>px;}' - record order, no whitespace.
export function themeStyle(): string {
  const declarations = Object.entries(cssVariables())
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  return `:root{${declarations}}`;
}

// themeStyle() + '\n:root{color-scheme:dark}\n'. Served as /site/tokens.css for the static legal pages.
export function siteTokensCss(): string {
  return `${themeStyle()}\n:root{color-scheme:dark}\n`;
}
