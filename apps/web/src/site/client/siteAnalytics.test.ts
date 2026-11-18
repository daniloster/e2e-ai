import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyticsModules, SiteAnalyticsEvent } from './siteAnalytics';

type SiteAnalyticsModule = typeof import('./siteAnalytics');

const VIDEO: SiteAnalyticsEvent = { name: 'consent_choice', params: { analytics: true } };

function spies() {
  const initFirebase = vi.fn(() => Promise.resolve());
  const track = vi.fn();
  const load = vi.fn(() => Promise.resolve<AnalyticsModules>({ initFirebase, track }));
  return { initFirebase, track, load };
}

// A fresh module per test, so the page-view state starts empty.
async function fresh(): Promise<SiteAnalyticsModule> {
  vi.resetModules();
  return import('./siteAnalytics');
}

afterEach(() => {
  vi.doUnmock('../../firebase');
  vi.doUnmock('../../analytics');
  vi.restoreAllMocks();
});

describe('siteTrack before start', () => {
  it('is a no-op that never loads the facade', async () => {
    const { siteTrack } = await fresh();
    const { load, track } = spies();
    expect(() => siteTrack(VIDEO)).not.toThrow();
    expect(load).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});

describe('startSiteAnalytics', () => {
  let s: ReturnType<typeof spies>;
  beforeEach(() => {
    s = spies();
  });

  it('loads once, initialises once, sends site_page_view, then forwards', async () => {
    const { startSiteAnalytics, siteTrack } = await fresh();
    await startSiteAnalytics({ page: 'faq', locale: 'es', load: s.load });
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(s.initFirebase).toHaveBeenCalledTimes(1);
    expect(s.track.mock.calls).toEqual([
      [{ name: 'site_page_view', params: { page: 'faq', locale: 'es' } }],
    ]);
    siteTrack(VIDEO);
    expect(s.track).toHaveBeenLastCalledWith(VIDEO);
  });

  it('sends consent_choice after site_page_view only on a choice', async () => {
    const withChoice = await fresh();
    await withChoice.startSiteAnalytics({
      page: 'home',
      locale: 'en-GB',
      choice: true,
      load: s.load,
    });
    expect(s.track.mock.calls.map((c) => (c[0] as SiteAnalyticsEvent).name)).toEqual([
      'site_page_view',
      'consent_choice',
    ]);
    expect(s.track.mock.calls[1]![0]).toEqual({
      name: 'consent_choice',
      params: { analytics: true },
    });

    const other = spies();
    const withoutChoice = await fresh();
    await withoutChoice.startSiteAnalytics({ page: 'home', locale: 'en-GB', load: other.load });
    expect(other.track.mock.calls.map((c) => (c[0] as SiteAnalyticsEvent).name)).toEqual([
      'site_page_view',
    ]);
  });

  it('is idempotent, concurrently and sequentially', async () => {
    const { startSiteAnalytics } = await fresh();
    const deps = { page: 'home', locale: 'en-GB', load: s.load } as const;
    await Promise.all([startSiteAnalytics(deps), startSiteAnalytics(deps)]);
    await startSiteAnalytics(deps);
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(s.initFirebase).toHaveBeenCalledTimes(1);
    expect(s.track).toHaveBeenCalledTimes(1);
  });

  it('drops events sent while loading, with no replay', async () => {
    let resolveInit!: () => void;
    s.initFirebase.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInit = resolve;
        }),
    );
    const { startSiteAnalytics, siteTrack } = await fresh();
    const started = startSiteAnalytics({ page: 'home', locale: 'en-GB', load: s.load });
    await vi.waitFor(() => expect(s.initFirebase).toHaveBeenCalled());
    siteTrack(VIDEO);
    resolveInit();
    await started;
    expect(s.track.mock.calls).toEqual([
      [{ name: 'site_page_view', params: { page: 'home', locale: 'en-GB' } }],
    ]);
  });

  it('never rejects when load or initFirebase rejects', async () => {
    const failingLoad = vi.fn(() => Promise.reject(new Error('offline')));
    const a = await fresh();
    await expect(
      a.startSiteAnalytics({ page: 'home', locale: 'en-GB', load: failingLoad }),
    ).resolves.toBeUndefined();
    expect(() => a.siteTrack(VIDEO)).not.toThrow();

    s.initFirebase.mockImplementation(() => Promise.reject(new Error('blocked')));
    const b = await fresh();
    await expect(
      b.startSiteAnalytics({ page: 'home', locale: 'en-GB', load: s.load }),
    ).resolves.toBeUndefined();
    b.siteTrack(VIDEO);
    expect(s.track).not.toHaveBeenCalled();
  });

  it('never throws when track throws', async () => {
    s.track.mockImplementation(() => {
      throw new Error('boom');
    });
    const { startSiteAnalytics, siteTrack } = await fresh();
    await expect(
      startSiteAnalytics({ page: 'home', locale: 'en-GB', load: s.load }),
    ).resolves.toBeUndefined();
    expect(() => siteTrack(VIDEO)).not.toThrow();
  });
});

describe('stopSiteAnalytics', () => {
  it('makes every later siteTrack a no-op', async () => {
    const s = spies();
    const { startSiteAnalytics, stopSiteAnalytics, siteTrack } = await fresh();
    await startSiteAnalytics({ page: 'home', locale: 'en-GB', load: s.load });
    s.track.mockClear();
    stopSiteAnalytics();
    siteTrack(VIDEO);
    expect(s.track).not.toHaveBeenCalled();
  });

  it('wins over an in-flight start', async () => {
    const s = spies();
    const { startSiteAnalytics, stopSiteAnalytics, siteTrack } = await fresh();
    const started = startSiteAnalytics({ page: 'home', locale: 'en-GB', load: s.load });
    stopSiteAnalytics();
    await started;
    siteTrack(VIDEO);
    expect(s.track).not.toHaveBeenCalled();
  });

  it('is cleared by a later start, which does not reload or resend the page view', async () => {
    const s = spies();
    const { startSiteAnalytics, stopSiteAnalytics, siteTrack } = await fresh();
    await startSiteAnalytics({ page: 'home', locale: 'en-GB', load: s.load });
    stopSiteAnalytics();
    await startSiteAnalytics({ page: 'home', locale: 'en-GB', choice: true, load: s.load });
    siteTrack(VIDEO);
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(s.initFirebase).toHaveBeenCalledTimes(1);
    expect(s.track.mock.calls.map((c) => (c[0] as SiteAnalyticsEvent).name)).toEqual([
      'site_page_view',
      'consent_choice',
      'consent_choice',
    ]);
  });
});

describe('loadAnalyticsModules', () => {
  it('returns the facade initFirebase and track', async () => {
    const initFirebase = vi.fn(() => Promise.resolve());
    const track = vi.fn();
    vi.resetModules();
    vi.doMock('../../firebase', () => ({ initFirebase }));
    vi.doMock('../../analytics', () => ({ track }));
    const { loadAnalyticsModules } = await import('./siteAnalytics');
    const modules = await loadAnalyticsModules();
    expect(modules.initFirebase).toBe(initFirebase);
    expect(modules.track).toBe(track);
  });

  it('is the default loader of startSiteAnalytics', async () => {
    const initFirebase = vi.fn(() => Promise.resolve());
    const track = vi.fn();
    vi.resetModules();
    vi.doMock('../../firebase', () => ({ initFirebase }));
    vi.doMock('../../analytics', () => ({ track }));
    const { startSiteAnalytics } = await import('./siteAnalytics');
    await startSiteAnalytics({ page: 'faq', locale: 'pt-BR' });
    expect(initFirebase).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: 'site_page_view',
      params: { page: 'faq', locale: 'pt-BR' },
    });
  });
});
