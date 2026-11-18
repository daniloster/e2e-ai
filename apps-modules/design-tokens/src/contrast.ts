// WCAG 2.x relative luminance and contrast ratio for #rrggbb colours.
const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance in [0, 1]. Throws a RangeError unless `hex` is `#` and six hex digits. */
export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new RangeError(`expected a #rrggbb colour, got ${JSON.stringify(hex)}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** (Lmax + 0.05) / (Lmin + 0.05): the same whichever argument is lighter. Not rounded. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
