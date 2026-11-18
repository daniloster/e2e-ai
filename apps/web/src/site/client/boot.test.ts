// The site client boot: page and locale from <html>, consent across page views with
// a spy loader (a page view = a fresh module graph), granted auto-start, never throws.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Layout } from '../layout/Layout';
import { SITE_PAGES, createRenderContext } from '../pages';
import type { StoreLinks } from '../config';
import { StoreBadges } from '../ui/StoreBadges';
import { CONSENT_KEY, CONSENT_TTL_MS } from './consent';
import type { AnalyticsModules, SiteAnalyticsEvent } from './siteAnalytics';

const NOW = 100 * CONSENT_TTL_MS;

function renderHome(locale: Locale, sitePage: string | null = 'home'): void {
  const root = document.documentElement;
  root.lang = locale;
  if (sitePage === null) delete root.dataset.sitePage;
  else root.dataset.sitePage = sitePage;
  document.body.innerHTML = renderToStaticMarkup(
    createElement(Layout, {
      t: createSiteTranslator(locale),
      ctx: createRenderContext(locale, SITE_PAGES),
      current: 'home',
      children: createElement('p', null, 'x'),
    }),
  );
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

function fakeWindow(storage: unknown): Window {
  return { document, localStorage: storage } as unknown as Window;
}

function spies() {
  const initFirebase = vi.fn(() => Promise.resolve());
  const track = vi.fn<(e: SiteAnalyticsEvent) => void>();
  const load = vi.fn(() => Promise.resolve<AnalyticsModules>({ initFirebase, track }));
  return { initFirebase, track, load };
}

// One page view: fresh modules, so siteAnalytics starts empty.
async function pageView() {
  vi.resetModules();
  const { bootSite } = await import('./boot');
  const { siteTrack } = await import('./siteAnalytics');
  return { bootSite, siteTrack };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const banner = () => document.querySelector<HTMLElement>('[data-consent-banner]')!;
const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.click();
const names = (track: ReturnType<typeof spies>['track']) => track.mock.calls.map((c) => c[0].name);
const VIDEO: SiteAnalyticsEvent = { name: 'consent_choice', params: { analytics: true } };

beforeEach(() => {
  renderHome('en-GB');
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = 'en-GB';
  delete document.documentElement.dataset.sitePage;
});

describe('bootSite', () => {
  it('shows the banner with empty storage, keeps focus, and loads nothing', async () => {
    const s = spies();
    const before = document.activeElement;
    const { bootSite } = await pageView();
    bootSite(fakeWindow(memoryStorage()), { load: s.load, now: () => NOW });
    await settle();
    expect(banner().hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-consent-settings]')!.hidden).toBe(false);
    expect(document.activeElement).toBe(before);
    expect(s.load).not.toHaveBeenCalled();
  });

  it.each<Locale>(['es', 'pt-BR'])(
    'Allow starts analytics with the page and %s locale; the next page view starts on its own',
    async (locale) => {
      renderHome(locale);
      const storage = memoryStorage();
      const first = spies();
      const view1 = await pageView();
      view1.bootSite(fakeWindow(storage), { load: first.load, now: () => NOW });
      click('[data-consent="accept"]');
      expect(JSON.parse(storage.items.get(CONSENT_KEY)!)).toEqual({
        v: 1,
        analytics: true,
        atMs: NOW,
      });
      expect(banner().hidden).toBe(true);
      await vi.waitFor(() => expect(first.track).toHaveBeenCalledTimes(2));
      expect(first.load).toHaveBeenCalledTimes(1);
      expect(first.initFirebase).toHaveBeenCalledTimes(1);
      expect(first.track.mock.calls.map((c) => c[0])).toEqual([
        { name: 'site_page_view', params: { page: 'home', locale } },
        { name: 'consent_choice', params: { analytics: true } },
      ]);

      renderHome(locale);
      const second = spies();
      const view2 = await pageView();
      view2.bootSite(fakeWindow(storage), { load: second.load, now: () => NOW + 1000 });
      expect(banner().hidden).toBe(true);
      await vi.waitFor(() => expect(second.track).toHaveBeenCalledTimes(1));
      expect(names(second.track)).toEqual(['site_page_view']);
    },
  );

  it.each([
    ['No thanks', () => click('[data-consent="decline"]')],
    [
      'Escape',
      () => {
        const accept = document.querySelector<HTMLElement>('[data-consent="accept"]')!;
        accept.focus();
        accept.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      },
    ],
  ])(
    '%s stores the refusal and never loads, now or on the next page view',
    async (_case, refuse) => {
      const storage = memoryStorage();
      const s = spies();
      const view1 = await pageView();
      view1.bootSite(fakeWindow(storage), { load: s.load, now: () => NOW });
      refuse();
      expect(JSON.parse(storage.items.get(CONSENT_KEY)!)).toMatchObject({ analytics: false });
      expect(banner().hidden).toBe(true);
      await settle();

      renderHome('en-GB');
      const view2 = await pageView();
      view2.bootSite(fakeWindow(storage), { load: s.load, now: () => NOW + 1000 });
      view2.siteTrack(VIDEO);
      await settle();
      expect(banner().hidden).toBe(true);
      expect(s.load).not.toHaveBeenCalled();
    },
  );

  it('No thanks from Cookie settings after Allow stops every later siteTrack', async () => {
    const storage = memoryStorage();
    const s = spies();
    const { bootSite, siteTrack } = await pageView();
    bootSite(fakeWindow(storage), { load: s.load, now: () => NOW });
    click('[data-consent="accept"]');
    await vi.waitFor(() => expect(s.track).toHaveBeenCalledTimes(2));
    const settingsButton = document.querySelector<HTMLElement>('[data-consent-settings]')!;
    settingsButton.focus();
    settingsButton.click();
    expect(banner().hidden).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('[data-consent="accept"]'));
    click('[data-consent="decline"]');
    expect(JSON.parse(storage.items.get(CONSENT_KEY)!)).toMatchObject({ analytics: false });
    expect(document.activeElement).toBe(settingsButton);
    siteTrack(VIDEO);
    expect(s.track).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'localStorage access throwing',
      {
        get localStorage(): Storage {
          throw new Error('SecurityError');
        },
        document,
      } as unknown as Window,
    ],
    [
      'getItem and setItem throwing',
      fakeWindow({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ],
  ])('survives %s: the banner shows and Allow still starts analytics', async (_case, win) => {
    const s = spies();
    const { bootSite } = await pageView();
    expect(() => bootSite(win, { load: s.load, now: () => NOW })).not.toThrow();
    expect(banner().hidden).toBe(false);
    click('[data-consent="accept"]');
    expect(banner().hidden).toBe(true);
    await vi.waitFor(() => expect(s.track).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['missing', null],
    ['unknown', 'about'],
  ])('never loads analytics when data-site-page is %s', async (_case, sitePage) => {
    renderHome('en-GB', sitePage);
    const storage = memoryStorage();
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: true, atMs: NOW }));
    const s = spies();
    const { bootSite } = await pageView();
    bootSite(fakeWindow(storage), { load: s.load, now: () => NOW });
    click('[data-consent-settings]');
    click('[data-consent="accept"]');
    await settle();
    expect(s.load).not.toHaveBeenCalled();
    expect(JSON.parse(storage.items.get(CONSENT_KEY)!)).toMatchObject({ analytics: true });
  });

  it('reads an unsupported lang as en', async () => {
    renderHome('en-GB');
    document.documentElement.lang = 'fr';
    const storage = memoryStorage();
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: true, atMs: NOW }));
    const s = spies();
    const { bootSite } = await pageView();
    bootSite(fakeWindow(storage), { load: s.load, now: () => NOW });
    await vi.waitFor(() => expect(s.track).toHaveBeenCalledTimes(1));
    expect(s.track.mock.calls[0]![0]).toEqual({
      name: 'site_page_view',
      params: { page: 'home', locale: 'en-GB' },
    });
  });

  it('starts analytics from a granted record even without banner markup', async () => {
    document.body.innerHTML = '<main id="main"></main>';
    const storage = memoryStorage();
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: true, atMs: NOW }));
    const s = spies();
    const { bootSite } = await pageView();
    expect(() => bootSite(fakeWindow(storage), { load: s.load, now: () => NOW })).not.toThrow();
    await vi.waitFor(() => expect(s.track).toHaveBeenCalledTimes(1));
  });

  it('asks again when the record is older than 12 months', async () => {
    const storage = memoryStorage();
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: true, atMs: 0 }));
    const s = spies();
    const { bootSite } = await pageView();
    bootSite(fakeWindow(storage), { load: s.load, now: () => NOW });
    await settle();
    expect(banner().hidden).toBe(false);
    expect(s.load).not.toHaveBeenCalled();
  });

  it('never throws, whatever the window holds', async () => {
    const { bootSite } = await pageView();
    expect(() => bootSite({} as Window)).not.toThrow();
    expect(() => bootSite(null as unknown as Window)).not.toThrow();
  });

  it('uses the real clock and loader by default', async () => {
    const { bootSite } = await pageView();
    const storage = memoryStorage();
    expect(() => bootSite(fakeWindow(storage))).not.toThrow();
    click('[data-consent="decline"]');
    const record = JSON.parse(storage.items.get(CONSENT_KEY)!) as { atMs: number };
    expect(Math.abs(record.atMs - Date.now())).toBeLessThan(60_000);
  });
});

const LIVE: StoreLinks = {
  appStore: 'https://apps.apple.com/app/id1',
  googlePlay: 'https://play.google.com/store/apps/details?id=x',
};

// The Home shape: the Layout with hero badges in <main>.
function renderLinkedHome(sitePage: string | null = 'home'): void {
  const root = document.documentElement;
  root.lang = 'en-GB';
  if (sitePage === null) delete root.dataset.sitePage;
  else root.dataset.sitePage = sitePage;
  const t = createSiteTranslator('en-GB');
  document.body.innerHTML = renderToStaticMarkup(
    createElement(Layout, {
      t,
      ctx: createRenderContext('en-GB', SITE_PAGES),
      current: 'home',
      children: createElement(StoreBadges, { t, links: LIVE, placement: 'hero' }),
    }),
  );
}

function linkedWindow(storage: unknown, navigator: unknown = {}): Window {
  return { document, localStorage: storage, navigator } as unknown as Window;
}

function stopNavigation(event: Event): void {
  event.preventDefault();
}

const anchor = (selector: string) => document.querySelector<HTMLAnchorElement>(selector)!;
const suggestion = (locale: string) =>
  document.querySelector<HTMLElement>(`[data-locale-suggestion="${locale}"]`)!;

describe('bootSite bindings', () => {
  beforeEach(() => {
    document.addEventListener('click', stopNavigation);
    renderLinkedHome();
  });

  afterEach(() => {
    document.removeEventListener('click', stopNavigation);
  });

  it('rewrites store links without consent and sends nothing', async () => {
    const s = spies();
    const { bootSite } = await pageView();
    bootSite(linkedWindow(memoryStorage()), { load: s.load, now: () => NOW, links: LIVE });
    const apple = anchor('a[data-store="app_store"]');
    apple.click();
    await settle();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('home');
    expect(new URL(apple.href).searchParams.has('pt')).toBe(false);
    expect(s.load).not.toHaveBeenCalled();
    expect(s.track).not.toHaveBeenCalled();
  });

  it('passes the provider token to the store links', async () => {
    const { bootSite } = await pageView();
    bootSite(linkedWindow(memoryStorage()), { now: () => NOW, links: LIVE, providerToken: 'PT1' });
    const apple = anchor('a[data-store="app_store"]');
    apple.click();
    expect(new URL(apple.href).searchParams.get('pt')).toBe('PT1');
  });

  it('tracks store clicks after Allow', async () => {
    const s = spies();
    const { bootSite } = await pageView();
    bootSite(linkedWindow(memoryStorage()), { load: s.load, now: () => NOW, links: LIVE });
    click('[data-consent="accept"]');
    await vi.waitFor(() => expect(names(s.track)).toContain('consent_choice'));
    s.track.mockClear();
    anchor('a[data-store="google_play"]').click();
    expect(s.track.mock.calls.map((c) => c[0])).toEqual([
      {
        name: 'store_click',
        params: { store: 'google_play', placement: 'hero', page: 'home', locale: 'en-GB' },
      },
    ]);
  });

  it('reveals the language suggestion from the navigator', async () => {
    const { bootSite } = await pageView();
    const writeText = vi.fn(() => Promise.resolve());
    bootSite(linkedWindow(memoryStorage(), { languages: ['es-MX'], clipboard: { writeText } }), {
      now: () => NOW,
    });
    expect(suggestion('es').hidden).toBe(false);
    expect(suggestion('pt-BR').hidden).toBe(true);
  });

  it('falls back to navigator.language', async () => {
    const { bootSite } = await pageView();
    bootSite(linkedWindow(memoryStorage(), { languages: [], language: 'pt-PT' }), {
      now: () => NOW,
    });
    expect(suggestion('pt-BR').hidden).toBe(false);
  });

  it('binds nothing without a page id, but still suggests a language', async () => {
    renderLinkedHome(null);
    const { bootSite } = await pageView();
    const writeText = vi.fn(() => Promise.resolve());
    bootSite(linkedWindow(memoryStorage(), { languages: ['es'], clipboard: { writeText } }), {
      now: () => NOW,
      links: LIVE,
    });
    const apple = anchor('a[data-store="app_store"]');
    apple.click();
    expect(apple.href).toBe(LIVE.appStore);
    expect(suggestion('es').hidden).toBe(false);
  });

  it('isolates a throwing binder from the others', async () => {
    const { bootSite } = await pageView();
    const deps = {
      now: () => NOW,
      get links(): StoreLinks {
        throw new Error('boom');
      },
    };
    const writeText = vi.fn(() => Promise.resolve());
    expect(() =>
      bootSite(
        linkedWindow(memoryStorage(), { languages: ['es'], clipboard: { writeText } }),
        deps,
      ),
    ).not.toThrow();
    expect(suggestion('es').hidden).toBe(false);
  });

  it('survives a navigator that throws', async () => {
    const { bootSite } = await pageView();
    const win = {
      document,
      localStorage: memoryStorage(),
      get navigator(): Navigator {
        throw new Error('blocked');
      },
    } as unknown as Window;
    expect(() => bootSite(win, { now: () => NOW, links: LIVE })).not.toThrow();
    const apple = anchor('a[data-store="app_store"]');
    apple.click();
    expect(new URL(apple.href).searchParams.get('ct')).toBe('home');
  });
});
