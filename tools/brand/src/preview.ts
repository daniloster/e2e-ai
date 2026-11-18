// The legibility preview sheet: a review aid written to the git-ignored
// tools/brand/out/, never committed. Each tile is rendered at its real pixel size with the same
// functions the targets use and embedded 1:1, so small sizes show their real rasterisation.
import { UI_COLORS } from '@pn/design-tokens';

import { renderPng } from './png';
import { SPLASH_CONSTANTS } from './splashConstants';
import { markDocument, toSvg } from './svg';
import { legacyRoundDocument } from './targets/icons';
import { splashLogoPng } from './targets/splash';

export const PREVIEW_PATH = 'tools/brand/out/preview.png';
export const PREVIEW_SIZE = 1280;

type Mask = 'circle' | 'squircle';
type Tile =
  | { kind: 'icon'; x: number; y: number; variant: 'any' | 'dark' | 'tinted'; px: number }
  | { kind: 'legacyRound'; x: number; y: number }
  | { kind: 'masked'; x: number; y: number; layer: 'adaptiveFg' | 'monochrome'; mask: Mask }
  | { kind: 'splash'; x: number; y: number; variant: 'splashLight' | 'splashDark' };

/** Masked tiles: the 72 dp visible area of the 108 dp adaptive layer, at 3x. */
const VISIBLE = 216;
const LAYER = 324;
const SQUIRCLE_RADIUS = 69; // ~0.32 x 216, an approximation of the AOSP squircle
const SPLASH_TILE = 512;
const SPLASH_SCALE = 3;

const TILES: readonly Tile[] = Object.freeze([
  { kind: 'icon', x: 40, y: 40, variant: 'any', px: 87 },
  { kind: 'icon', x: 167, y: 40, variant: 'any', px: 120 },
  { kind: 'icon', x: 327, y: 40, variant: 'any', px: 180 },
  { kind: 'icon', x: 547, y: 40, variant: 'dark', px: 180 },
  { kind: 'icon', x: 767, y: 40, variant: 'tinted', px: 180 },
  { kind: 'legacyRound', x: 987, y: 40 },
  { kind: 'masked', x: 40, y: 280, layer: 'adaptiveFg', mask: 'circle' },
  { kind: 'masked', x: 296, y: 280, layer: 'adaptiveFg', mask: 'squircle' },
  { kind: 'masked', x: 552, y: 280, layer: 'monochrome', mask: 'circle' },
  { kind: 'masked', x: 808, y: 280, layer: 'monochrome', mask: 'squircle' },
  { kind: 'splash', x: 40, y: 536, variant: 'splashLight' },
  { kind: 'splash', x: 592, y: 536, variant: 'splashDark' },
] satisfies Tile[]);

function dataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

function image(x: number, y: number, png: Uint8Array, px: number): string {
  return `<image x="${x}" y="${y}" width="${px}" height="${px}" href="${dataUri(png)}"/>`;
}

function square(x: number, y: number, px: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${px}" height="${px}" fill="${fill}"/>`;
}

function maskShape(mask: Mask, x: number, y: number, fill: string): string {
  const r = VISIBLE / 2;
  return mask === 'circle'
    ? `<circle cx="${x + r}" cy="${y + r}" r="${r}"${fill === '' ? '' : ` fill="${fill}"`}/>`
    : `<rect x="${x}" y="${y}" width="${VISIBLE}" height="${VISIBLE}" rx="${SQUIRCLE_RADIUS}"${fill === '' ? '' : ` fill="${fill}"`}/>`;
}

/** The round legacy icon, as the icons target builds ic_launcher_round.png: mark on a circular ground. */
function legacyRoundSvg(px: number): string {
  const doc = legacyRoundDocument(px);
  const svg = toSvg({ ...doc, palette: { ...doc.palette, ground: null } });
  const open = /^<svg [^>]*>/.exec(svg)?.[0] ?? '';
  const r = px / 2;
  return `${open}<circle cx="${r}" cy="${r}" r="${r}" fill="${UI_COLORS.bg}"/>${svg.slice(open.length)}`;
}

function tileSvg(tile: Tile, index: number): string {
  switch (tile.kind) {
    case 'icon': {
      const png = renderPng(toSvg(markDocument(tile.variant, tile.px)), tile.px, {
        opaque: tile.variant === 'any',
      });
      const under =
        tile.variant === 'any' ? '' : square(tile.x, tile.y, tile.px, UI_COLORS.surface);
      return under + image(tile.x, tile.y, png, tile.px);
    }
    case 'legacyRound':
      return image(tile.x, tile.y, renderPng(legacyRoundSvg(192), 192), 192);
    case 'masked': {
      const png = renderPng(toSvg(markDocument(tile.layer, 108)), LAYER);
      const ground = tile.layer === 'adaptiveFg' ? UI_COLORS.bg : UI_COLORS.line;
      const offset = (LAYER - VISIBLE) / 2;
      return (
        `<clipPath id="m${index}">${maskShape(tile.mask, tile.x, tile.y, '')}</clipPath>` +
        maskShape(tile.mask, tile.x, tile.y, ground) +
        `<g clip-path="url(#m${index})">${image(tile.x - offset, tile.y - offset, png, LAYER)}</g>`
      );
    }
    case 'splash': {
      const ground =
        tile.variant === 'splashLight'
          ? SPLASH_CONSTANTS.background.light
          : SPLASH_CONSTANTS.background.dark;
      const px = SPLASH_CONSTANTS.logoWidthDp * SPLASH_SCALE;
      const offset = (SPLASH_TILE - px) / 2;
      return (
        square(tile.x, tile.y, SPLASH_TILE, ground) +
        image(tile.x + offset, tile.y + offset, splashLogoPng(tile.variant, SPLASH_SCALE), px)
      );
    }
  }
}

/** 1280 px square PNG: the mark at 29/40/60 pt @3x, Dark, Tinted, legacy round, adaptive and monochrome in circle and squircle masks, both splash logos on their grounds. */
export function buildPreviewSheet(): Uint8Array {
  const size = PREVIEW_SIZE;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    square(0, 0, size, UI_COLORS.line) +
    TILES.map(tileSvg).join('') +
    '</svg>';
  return renderPng(svg, size);
}
