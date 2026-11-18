// Store badges: coming-soon, live and mixed states, data attributes, locale text.
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import { STORE_LINKS } from '../config';
import { StoreBadges, type StoreLinks, type StorePlacement } from './StoreBadges';

const APP = 'https://apps.apple.com/app/id1';
const PLAY = 'https://play.google.com/store/apps/details?id=x';

function render(links: StoreLinks, placement: StorePlacement, locale: Locale = 'en-GB') {
  const html = renderToStaticMarkup(
    <StoreBadges t={createSiteTranslator(locale)} links={links} placement={placement} />,
  );
  return { html, doc: new DOMParser().parseFromString(html, 'text/html') };
}

describe('StoreBadges', () => {
  it('renders two coming-soon badges with no link when both URLs are null', () => {
    const { html, doc } = render({ appStore: null, googlePlay: null }, 'hero');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    const items = doc.querySelectorAll('ul > li');
    expect(items).toHaveLength(2);
    const badges = [...doc.querySelectorAll('[data-store]')];
    expect(badges.map((b) => b.getAttribute('data-store'))).toEqual(['app_store', 'google_play']);
    for (const badge of badges) {
      expect(badge.tagName).toBe('SPAN');
      expect(badge.getAttribute('data-placement')).toBe('hero');
      expect(badge.hasAttribute('data-coming-soon')).toBe(true);
    }
    expect(html.match(/Coming soon/g)).toHaveLength(2);
    expect(badges[0]?.textContent).toContain('Download on the App Store');
    expect(badges[1]?.textContent).toContain('Get it on Google Play');
  });

  it('renders two live links with rel, data-store and data-placement', () => {
    const { html, doc } = render({ appStore: APP, googlePlay: PLAY }, 'footer');
    const links = [...doc.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([APP, PLAY]);
    expect(links.map((a) => a.getAttribute('data-store'))).toEqual(['app_store', 'google_play']);
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener');
      expect(link.getAttribute('data-placement')).toBe('footer');
      expect(link.hasAttribute('target')).toBe(false);
      expect(link.hasAttribute('data-coming-soon')).toBe(false);
    }
    expect(html).not.toContain('Coming soon');
  });

  it('mixes a coming-soon App Store badge with a live Google Play link', () => {
    const { doc } = render({ appStore: null, googlePlay: PLAY }, 'page');
    const [appStore, googlePlay] = [...doc.querySelectorAll('[data-store]')];
    expect(appStore?.tagName).toBe('SPAN');
    expect(appStore?.hasAttribute('data-coming-soon')).toBe(true);
    expect(appStore?.querySelector('[href]')).toBeNull();
    expect(googlePlay?.tagName).toBe('A');
    expect(googlePlay?.getAttribute('href')).toBe(PLAY);
    expect(doc.querySelectorAll('[data-placement="page"]')).toHaveLength(2);
  });

  it('draws one decorative currentColor glyph per badge', () => {
    const { doc } = render({ appStore: APP, googlePlay: null }, 'hero');
    const glyphs = [...doc.querySelectorAll('svg')];
    expect(glyphs).toHaveLength(2);
    for (const svg of glyphs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(svg.querySelector('title')).toBeNull();
    }
  });

  it('uses the es labels', () => {
    const { html } = render({ appStore: null, googlePlay: null }, 'hero', 'es');
    expect(html).toContain('Descargar en la App Store');
    expect(html).toContain('Disponible en Google Play');
    expect(html.match(/Próximamente/g)).toHaveLength(2);
  });
});

describe('STORE_LINKS', () => {
  it('links no store until a listing is flipped live, and is frozen', () => {
    expect(STORE_LINKS).toEqual({ appStore: null, googlePlay: null });
    expect(Object.isFrozen(STORE_LINKS)).toBe(true);
  });
});
