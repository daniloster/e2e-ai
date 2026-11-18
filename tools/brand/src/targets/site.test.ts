import { UI_COLORS } from '@pn/design-tokens';
import { beforeAll, describe, expect, it } from 'vitest';

import { readPngInfo, renderPng } from '../png';
import { assertWellFormedXml } from '../testing/xmlWellFormed';
import type { FileMap } from '../types';
import { buildSiteFiles, OG_HEIGHT, OG_WIDTH, ogCardSvg, SITE_ASSET_DIR, SITE_FILES } from './site';

const OPAQUE = { heightPx: OG_HEIGHT, opaque: true };

describe('ogCardSvg', () => {
  const card = ogCardSvg();

  it('opens with the 1200x630 canvas on the UI ground and nests only the mark', () => {
    expect(
      card.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
          `<rect width="1200" height="630" fill="${UI_COLORS.bg}"/>`,
      ),
    ).toBe(true);
    assertWellFormedXml(card);
    expect(card.match(/<svg x=/g)).toHaveLength(1);
    for (const banned of ['<text', '<script', '<image', '<style', 'href']) {
      expect(card).not.toContain(banned);
    }
  });

  it('renders an opaque 1200x630 PNG', { timeout: 60_000 }, () => {
    expect(readPngInfo(renderPng(card, OG_WIDTH, OPAQUE))).toEqual({
      width: 1200,
      height: 630,
      colorType: 2,
      hasAlpha: false,
    });
  });
});

describe('buildSiteFiles', () => {
  let files: FileMap;
  beforeAll(() => {
    files = buildSiteFiles();
  }, 60_000);

  const svg = (name: string): string => {
    const file = files.get(`${SITE_ASSET_DIR}/${name}`);
    if (typeof file !== 'string') throw new Error(`${name} is not text`);
    return file;
  };
  const png = (name: string): Uint8Array => {
    const file = files.get(`${SITE_ASSET_DIR}/${name}`);
    if (!(file instanceof Uint8Array)) throw new Error(`${name} is not binary`);
    return file;
  };

  it('writes the six files in order under apps/web/public/site', () => {
    expect(SITE_ASSET_DIR).toBe('apps/web/public/site');
    expect([...files.keys()]).toEqual(SITE_FILES.map((name) => `${SITE_ASSET_DIR}/${name}`));
  });

  it('renders the PNGs at their sizes, opaque', () => {
    expect(readPngInfo(png('apple-touch-icon.png'))).toMatchObject({ width: 180, hasAlpha: false });
    expect(readPngInfo(png('favicon-32.png'))).toMatchObject({ width: 32, height: 32 });
    expect(readPngInfo(png('og-default.png'))).toMatchObject({ width: 1200, height: 630 });
  });

  it('keeps the marks transparent and safe, the favicon on the UI ground', () => {
    for (const name of ['mark.svg', 'mark-on-dark.svg', 'favicon.svg']) {
      assertWellFormedXml(svg(name));
      for (const banned of ['<script', '<text', 'href']) expect(svg(name)).not.toContain(banned);
    }
    for (const name of ['mark.svg', 'mark-on-dark.svg']) {
      expect(svg(name)).not.toContain('<rect');
      expect(svg(name)).toContain(`fill="${UI_COLORS.primary}"`);
    }
    expect(svg('favicon.svg')).toContain(`<rect width="32" height="32" fill="${UI_COLORS.bg}"/>`);
  });

  it('nests the dark mark in the card', () => {
    expect(ogCardSvg()).toContain(svg('mark-on-dark.svg').replace(/^<svg [^>]*>/, ''));
  });
});
