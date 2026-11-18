// Store link rewrite and tracking on the real StoreBadges markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSiteTranslator } from '@pn/i18n/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreLinks } from '../config';
import { StoreBadges } from '../ui/StoreBadges';
import { bindStoreLinks } from './links';

const LIVE: StoreLinks = {
  appStore: 'https://apps.apple.com/app/id1',
  googlePlay: 'https://play.google.com/store/apps/details?id=x',
};
const TIKTOK = '?utm_source=tiktok&utm_medium=paid&utm_campaign=xmas26';

function render(links: StoreLinks, extra = ''): void {
  const t = createSiteTranslator('es');
  document.body.innerHTML =
    renderToStaticMarkup(createElement(StoreBadges, { t, links, placement: 'hero' })) + extra;
}

function badge(store: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-store="${store}"]`)!;
}

function stopNavigation(event: Event): void {
  event.preventDefault();
}

beforeEach(() => {
  document.addEventListener('click', stopNavigation);
});

afterEach(() => {
  document.removeEventListener('click', stopNavigation);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bindStoreLinks', () => {
  it('rewrites on pointerdown and click and tracks the click', () => {
    render(LIVE);
    const track = vi.fn();
    expect(
      bindStoreLinks(document, {
        page: 'home',
        locale: 'es',
        links: LIVE,
        search: () => TIKTOK,
        track,
      }),
    ).toBe(2);

    const play = badge('google_play') as HTMLAnchorElement;
    play.dispatchEvent(new Event('pointerdown'));
    expect(play.href).toBe(
      'https://play.google.com/store/apps/details?id=x&referrer=utm_source%3Dtiktok%26utm_medium%3Dpaid%26utm_campaign%3Dxmas26',
    );
    expect(track).not.toHaveBeenCalled();

    const apple = badge('app_store') as HTMLAnchorElement;
    apple.click();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('xmas26');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: 'store_click',
      params: { store: 'app_store', placement: 'hero', page: 'home', locale: 'es' },
    });
  });

  it('rewrites on Enter only and never stacks parameters', () => {
    render(LIVE);
    const track = vi.fn();
    bindStoreLinks(document, {
      page: 'home',
      locale: 'es',
      links: LIVE,
      search: () => TIKTOK,
      track,
    });
    const apple = badge('app_store') as HTMLAnchorElement;
    apple.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(apple.href).toBe(LIVE.appStore);
    apple.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(new URL(apple.href).searchParams.get('ct')).toBe('xmas26');
    apple.click();
    apple.click();
    expect(new URL(apple.href).searchParams.getAll('ct')).toEqual(['xmas26']);
    expect(track).toHaveBeenCalledTimes(2);
  });

  it('reads the search at interaction time, with the page as default campaign', () => {
    render(LIVE);
    let search = '';
    bindStoreLinks(document, {
      page: 'faq',
      locale: 'es',
      links: LIVE,
      providerToken: 'PT1',
      search: () => search,
      track: vi.fn(),
    });
    const apple = badge('app_store') as HTMLAnchorElement;
    apple.click();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('faq');
    expect(new URL(apple.href).searchParams.get('pt')).toBe('PT1');
    search = '?utm_campaign=later';
    apple.click();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('later');
  });

  it('defaults the search to the window location', () => {
    render(LIVE);
    bindStoreLinks(document, { page: 'home', locale: 'es', links: LIVE, track: vi.fn() });
    const apple = badge('app_store') as HTMLAnchorElement;
    apple.click();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('home');
  });

  it('is inert with both links null', () => {
    render({ appStore: null, googlePlay: null });
    const track = vi.fn();
    const query = vi.spyOn(document, 'querySelectorAll');
    const links = { appStore: null, googlePlay: null };
    expect(bindStoreLinks(document, { page: 'home', locale: 'es', track, links })).toBe(0);
    expect(query).not.toHaveBeenCalled();
    for (const store of ['app_store', 'google_play']) {
      expect(badge(store).hasAttribute('href')).toBe(false);
      badge(store).click();
    }
    expect(track).not.toHaveBeenCalled();
  });

  it('binds only live anchors', () => {
    const links = { appStore: null, googlePlay: LIVE.googlePlay };
    render(links, '<a href="https://x.test" data-store="amazon" data-placement="hero">x</a>');
    const track = vi.fn();
    expect(bindStoreLinks(document, { page: 'home', locale: 'es', links, track })).toBe(1);
    badge('app_store').click();
    badge('amazon').click();
    expect(track).not.toHaveBeenCalled();
  });

  it('rewrites a link with an unknown placement but sends nothing', () => {
    document.body.innerHTML = `<a href="${LIVE.appStore}" data-store="app_store" data-placement="banner">x</a>`;
    const track = vi.fn();
    bindStoreLinks(document, {
      page: 'home',
      locale: 'es',
      links: LIVE,
      search: () => TIKTOK,
      track,
    });
    const apple = badge('app_store') as HTMLAnchorElement;
    apple.click();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('xmas26');
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps the rendered href when the builder fails, without throwing', () => {
    const links = { appStore: '/relative', googlePlay: null };
    document.body.innerHTML =
      '<a href="/relative" data-store="app_store" data-placement="hero">x</a>';
    const track = vi.fn();
    const errors = vi.fn();
    window.addEventListener('error', errors);
    bindStoreLinks(document, { page: 'home', locale: 'es', links, track });
    const apple = badge('app_store') as HTMLAnchorElement;
    apple.dispatchEvent(new Event('pointerdown'));
    apple.click();
    window.removeEventListener('error', errors);
    expect(apple.getAttribute('href')).toBe('/relative');
    expect(track).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('never lets a throwing track escape and never prevents navigation', () => {
    render(LIVE);
    const errors = vi.fn();
    window.addEventListener('error', errors);
    bindStoreLinks(document, {
      page: 'home',
      locale: 'es',
      links: LIVE,
      track: () => {
        throw new Error('boom');
      },
    });
    document.removeEventListener('click', stopNavigation);
    let prevented: boolean | null = null;
    document.addEventListener(
      'click',
      (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    badge('app_store').click();
    window.removeEventListener('error', errors);
    expect(errors).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });
});

describe('consent gating through the real siteTrack', () => {
  it('sends nothing before startSiteAnalytics and store_click after', async () => {
    vi.resetModules();
    const links = await import('./links');
    const analytics = await import('./siteAnalytics');
    render(LIVE);
    const facadeTrack = vi.fn();
    const load = vi.fn(() =>
      Promise.resolve({ initFirebase: () => Promise.resolve(), track: facadeTrack }),
    );
    links.bindStoreLinks(document, { page: 'home', locale: 'es', links: LIVE });
    badge('app_store').click();
    expect(facadeTrack).not.toHaveBeenCalled();

    await analytics.startSiteAnalytics({ page: 'home', locale: 'es', load });
    facadeTrack.mockClear();
    badge('google_play').click();
    expect(facadeTrack).toHaveBeenCalledTimes(1);
    expect(facadeTrack).toHaveBeenCalledWith({
      name: 'store_click',
      params: { store: 'google_play', placement: 'hero', page: 'home', locale: 'es' },
    });
  });
});
