// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  APP_ID,
  APP_SCHEME,
  APP_STORE_LISTING,
  APPLE_APP_ID,
  APP_STORE_ID,
  APP_STORE_PROVIDER_TOKEN,
  CONTACT_EMAIL,
  GOOGLE_PLAY_LISTING,
  LISTINGS_LIVE,
  SITE_LOCALES,
  SITE_ORIGIN,
  SITE_PAGE_ANALYTICS_IDS,
  STORE_LINKS,
  isSitePageAnalyticsId,
  localeOfPath,
  pageOutPath,
  pagePath,
  pathLocaleOf,
} from './config';

describe('identity', () => {
  it('is Pocket Notes on its own origin, scheme and ids', () => {
    expect(SITE_ORIGIN).toBe('https://pocketnotes.app');
    expect(APP_SCHEME).toBe('pocketnotes');
    expect(APP_ID).toBe('com.pocketnotes');
    expect(GOOGLE_PLAY_LISTING).toBe(
      'https://play.google.com/store/apps/details?id=com.pocketnotes',
    );
    expect(APPLE_APP_ID).toMatch(/^\d{10}$/);
    expect(APP_STORE_LISTING).toBe(`https://apps.apple.com/app/id${APPLE_APP_ID}`);
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
  });

  it('links each store only once its listing is live', () => {
    expect(STORE_LINKS).toEqual({
      appStore: LISTINGS_LIVE.appStore ? APP_STORE_LISTING : null,
      googlePlay: LISTINGS_LIVE.googlePlay ? GOOGLE_PLAY_LISTING : null,
    });
    expect(APP_STORE_ID).toBe(LISTINGS_LIVE.appStore ? APPLE_APP_ID : null);
  });

  it('shows "coming soon" badges until a listing is flipped live', () => {
    expect(LISTINGS_LIVE).toEqual({ appStore: false, googlePlay: false });
    expect(STORE_LINKS).toEqual({ appStore: null, googlePlay: null });
    expect(Object.isFrozen(STORE_LINKS)).toBe(true);
    expect(APP_STORE_ID).toBeNull();
    expect(APP_STORE_PROVIDER_TOKEN).toBeNull();
  });
});

describe('SITE_LOCALES', () => {
  it('lists en-GB, es and pt-BR, frozen', () => {
    expect(SITE_LOCALES).toEqual(['en-GB', 'es', 'pt-BR']);
    expect(Object.isFrozen(SITE_LOCALES)).toBe(true);
  });
});

describe('pathLocaleOf and localeOfPath', () => {
  it('maps each locale to its lower-case path locale, en-GB unprefixed', () => {
    expect(pathLocaleOf('en-GB')).toBe('');
    expect(pathLocaleOf('es')).toBe('es');
    expect(pathLocaleOf('pt-BR')).toBe('pt-br');
  });

  it.each([
    ['/', 'en-GB'],
    ['/faq', 'en-GB'],
    ['/es/', 'es'],
    ['/ES/faq', 'es'],
    ['/pt-br/s', 'pt-BR'],
    ['/pt-BR/', 'pt-BR'],
    ['/fr/', 'en-GB'],
    ['', 'en-GB'],
  ] as const)('%s -> %s', (path, locale) => {
    expect(localeOfPath(path)).toBe(locale);
  });
});

describe('pagePath and pageOutPath', () => {
  it.each([
    ['', 'en-GB', '/', 'index.html'],
    ['', 'es', '/es/', 'es/index.html'],
    ['faq', 'en-GB', '/faq', 'faq.html'],
    ['s', 'pt-BR', '/pt-br/s', 'pt-br/s.html'],
  ] as const)('%j in %s', (slug, locale, path, out) => {
    expect(pagePath(slug, locale)).toBe(path);
    expect(pageOutPath(slug, locale)).toBe(out);
  });
});

describe('analytics page ids', () => {
  it('maps every page to a snake-case id', () => {
    expect(SITE_PAGE_ANALYTICS_IDS).toEqual({
      home: 'home',
      faq: 'faq',
      contact: 'contact',
      support: 'support',
      yourData: 'your_data',
      get: 'get',
      share: 'share',
    });
  });

  it.each(['home', 'your_data', 'share'])('accepts %s', (id) => {
    expect(isSitePageAnalyticsId(id)).toBe(true);
  });

  it.each(['rules', 'yourData', '', null, 1])('rejects %j', (id) => {
    expect(isSitePageAnalyticsId(id)).toBe(false);
  });
});
