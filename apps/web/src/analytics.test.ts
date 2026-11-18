import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { track, type SiteAnalyticsEvent, type WebAnalyticsEvent } from './analytics';

const mocks = vi.hoisted(() => ({
  handle: null as null | { analytics: { kind: string }; logEvent: ReturnType<typeof vi.fn> },
}));

vi.mock('./firebase', () => ({ getAnalyticsHandle: () => mocks.handle }));

const SITE_EVENTS: readonly SiteAnalyticsEvent[] = [
  { name: 'site_page_view', params: { page: 'home', locale: 'pt-BR' } },
  {
    name: 'store_click',
    params: { store: 'google_play', placement: 'hero', page: 'support', locale: 'es' },
  },
  { name: 'site_page_view', params: { page: 'share', locale: 'en-GB' } },
  { name: 'consent_choice', params: { analytics: true } },
];

beforeEach(() => {
  mocks.handle = { analytics: { kind: 'analytics' }, logEvent: vi.fn() };
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('track with the site events', () => {
  it('passes each site event to logEvent unchanged', () => {
    for (const event of SITE_EVENTS) {
      const handle = mocks.handle!;
      handle.logEvent.mockClear();
      track(event);
      expect(handle.logEvent).toHaveBeenCalledTimes(1);
      expect(handle.logEvent).toHaveBeenCalledWith(handle.analytics, event.name, event.params);
    }
  });

  it('passes the get page view to logEvent', () => {
    const handle = mocks.handle!;
    track({ name: 'site_page_view', params: { page: 'get', locale: 'es' } });
    expect(handle.logEvent).toHaveBeenCalledTimes(1);
    expect(handle.logEvent).toHaveBeenCalledWith(handle.analytics, 'site_page_view', {
      page: 'get',
      locale: 'es',
    });
  });

  it('does nothing and does not throw without a handle', () => {
    const logEvent = mocks.handle!.logEvent;
    mocks.handle = null;
    for (const event of SITE_EVENTS) expect(() => track(event)).not.toThrow();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('SiteAnalyticsEvent types', () => {
  it('holds exactly the three site event names', () => {
    expectTypeOf<SiteAnalyticsEvent['name']>().toEqualTypeOf<
      'site_page_view' | 'store_click' | 'consent_choice'
    >();
    expectTypeOf<SiteAnalyticsEvent>().toMatchTypeOf<WebAnalyticsEvent>();
  });

  it('rejects values outside the enums', () => {
    const badPage: SiteAnalyticsEvent = {
      name: 'site_page_view',
      // @ts-expect-error 'about' is not a site page id.
      params: { page: 'about', locale: 'en-GB' },
    };
    const badStore: SiteAnalyticsEvent = {
      name: 'store_click',
      // @ts-expect-error 'amazon' is not a store.
      params: { store: 'amazon', placement: 'hero', page: 'home', locale: 'en-GB' },
    };
    // @ts-expect-error consent_choice needs analytics.
    const badChoice: SiteAnalyticsEvent = { name: 'consent_choice', params: {} };
    expect([badPage, badStore, badChoice]).toHaveLength(3);
  });
});
