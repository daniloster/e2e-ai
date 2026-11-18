// The product site's brand assets as a FileMap: the tight transparent marks, the favicons, the
// Apple touch icon and the Open Graph card, a text-free 1200x630 image (no webfont, so og:title and
// og:description carry the words). Every colour comes from @pn/design-tokens.
import { UI_COLORS } from '@pn/design-tokens';

import { BRAND_MARK } from '../mark';
import { paletteFor } from '../palettes';
import { SITE_ASSET_DIR } from '../paths';
import { renderPng } from '../png';
import { markDocument, num, toSvg } from '../svg';
import type { BrandTarget, FileMap, MarkDocument } from '../types';

export { SITE_ASSET_DIR };

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const OG_MARK_SIZE = 360;
/** The card's bottom strata: [height, colour] from the bottom up. */
const OG_STRATA: readonly (readonly [number, string])[] = Object.freeze([
  Object.freeze([36, UI_COLORS.primary] as const),
  Object.freeze([24, UI_COLORS.secondary] as const),
  Object.freeze([12, UI_COLORS.line] as const),
]);

/** Write order. */
export const SITE_FILES: readonly string[] = Object.freeze([
  'mark.svg',
  'mark-on-dark.svg',
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'og-default.png',
]);

const SITE_MARK_CANVAS = 128;
const SITE_MARK_SIZE = 120;
const FAVICON_PX = 32;
const APPLE_TOUCH_PX = 180;

const OPEN_TAG = /^<svg [^>]*>/;
const VIEW_BOX = /\sviewBox="([^"]*)"/;

/** Replaces a standalone SVG's opening tag with a positioned nested <svg>, keeping its viewBox. */
function nestedSvg(svg: string, x: number, y: number, size: number): string {
  const open = OPEN_TAG.exec(svg)?.[0];
  const viewBox = open === undefined ? undefined : VIEW_BOX.exec(open)?.[1];
  if (open === undefined || viewBox === undefined) {
    throw new Error('unexpected SVG prefix: cannot nest a document without <svg viewBox>');
  }
  const s = num(size);
  return (
    `<svg x="${num(x)}" y="${num(y)}" width="${s}" height="${s}" viewBox="${viewBox}">` +
    svg.slice(open.length)
  );
}

/** The tight, transparent site mark for a palette variant (4 units of margin for the outline). */
function siteMarkDocument(variant: 'any' | 'splashDark'): MarkDocument {
  return {
    variant,
    palette: { ...paletteFor(variant), ground: null },
    placement: { canvas: SITE_MARK_CANVAS, markSize: SITE_MARK_SIZE },
    shapes: BRAND_MARK,
  };
}

/** The mark in splashDark colours on a transparent ground: mark-on-dark.svg, as the card nests it. */
function darkMarkSvg(): string {
  return toSvg(siteMarkDocument('splashDark'));
}

/** The 1200x630 card: the UI ground, the mark centred above the strata. No text. */
export function ogCardSvg(): string {
  const strataHeight = OG_STRATA.reduce((sum, [h]) => sum + h, 0);
  const markX = (OG_WIDTH - OG_MARK_SIZE) / 2;
  const markY = (OG_HEIGHT - strataHeight - OG_MARK_SIZE) / 2;
  let top = OG_HEIGHT;
  const strata = OG_STRATA.map(([h, fill]) => {
    top -= h;
    return `<rect y="${top}" width="${OG_WIDTH}" height="${h}" fill="${fill}"/>`;
  }).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">` +
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${UI_COLORS.bg}"/>` +
    strata +
    nestedSvg(darkMarkSvg(), markX, markY, OG_MARK_SIZE) +
    '</svg>'
  );
}

/** Every site asset, keyed by repo-relative path, in SITE_FILES order. */
export function buildSiteFiles(): FileMap {
  const favicon = toSvg(markDocument('any', FAVICON_PX));
  const appleTouch = toSvg(markDocument('any', APPLE_TOUCH_PX));
  const at = (name: string): string => `${SITE_ASSET_DIR}/${name}`;
  return new Map<string, Uint8Array | string>([
    [at('mark.svg'), toSvg(siteMarkDocument('any'))],
    [at('mark-on-dark.svg'), darkMarkSvg()],
    [at('favicon.svg'), favicon],
    [at('favicon-32.png'), renderPng(favicon, FAVICON_PX, { opaque: true })],
    [at('apple-touch-icon.png'), renderPng(appleTouch, APPLE_TOUCH_PX, { opaque: true })],
    [at('og-default.png'), renderPng(ogCardSvg(), OG_WIDTH, { heightPx: OG_HEIGHT, opaque: true })],
  ]);
}

export const siteTarget: BrandTarget = Object.freeze({ id: 'site', build: buildSiteFiles });
