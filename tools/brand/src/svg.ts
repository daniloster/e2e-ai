// Composes a variant's MarkDocument and serialises it to SVG text. Presentation attributes only
// (no <style>, text, filters or images), so resvg and Android VectorDrawable read the same
// document; the same document always gives the same bytes.
import { BRAND_MARK, MONOCHROME_MARK } from './mark';
import { paletteFor } from './palettes';
import { placementFor } from './placement';
import type { MarkDocument, MarkShape, Palette, VariantId } from './types';

const BOX = 120;

/** Locale- and platform-independent numbers: at most 4 decimals, no trailing zeros. */
export function num(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function pathEl(shape: MarkShape, fill: string, palette: Palette): string {
  const rule = shape.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  const { d } = shape;
  if (palette.outline === null) return `<path d="${d}" fill="${fill}"${rule}/>`;
  return (
    `<path d="${d}" fill="${fill}"${rule} stroke="${palette.outline}" ` +
    `stroke-width="${num(palette.outlineWidth)}" stroke-linejoin="round"/>`
  );
}

export function markDocument(variant: VariantId, canvas: number): MarkDocument {
  return {
    variant,
    palette: paletteFor(variant),
    placement: placementFor(variant, canvas),
    // The single-colour layer cuts facets out instead of colouring them.
    shapes: variant === 'monochrome' ? MONOCHROME_MARK : BRAND_MARK,
  };
}

/** Deterministic SVG text: same document, same bytes. */
export function toSvg(doc: MarkDocument): string {
  const { palette, placement, shapes } = doc;
  const c = num(placement.canvas);
  const offset = num((placement.canvas - placement.markSize) / 2);
  const scale = num(placement.markSize / BOX);
  const ground =
    palette.ground === null ? '' : `<rect width="${c}" height="${c}" fill="${palette.ground}"/>`;
  const paths = shapes.map((s) => pathEl(s, palette.fills[s.role], palette)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${c}" viewBox="0 0 ${c} ${c}">` +
    ground +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">` +
    paths +
    '</g></svg>'
  );
}
