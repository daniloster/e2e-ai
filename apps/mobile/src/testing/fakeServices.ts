// In-memory AppServices for screen tests: storage in a plain object, analytics recorded, a fixed
// device and clock, and a linking double that can deliver URLs.
import type { AppServices } from '../app/AppProvider';
import type { StoredAnalyticsConsent } from '../services/storage';

export interface FakeServices extends AppServices {
  events: { name: string; params: unknown }[];
  errors: string[];
  stored: {
    locale: string | null;
    consent: StoredAnalyticsConsent | null;
    best: number | null;
  };
  /** Delivers a URL as if the OS opened the app with it while running. */
  openUrl: (url: string) => void;
}

export function fakeServices(
  options: {
    consent?: boolean | null;
    best?: number | null;
    initialUrl?: string | null;
    testInstall?: boolean;
  } = {},
): FakeServices {
  const listeners = new Set<(e: { url: string }) => void>();
  const events: FakeServices['events'] = [];
  const errors: string[] = [];
  const stored: FakeServices['stored'] = {
    locale: 'en-GB',
    consent:
      options.consent === undefined || options.consent === null
        ? null
        : { v: 1, analytics: options.consent, atMs: 0 },
    best: options.best ?? null,
  };
  return {
    events,
    errors,
    stored,
    openUrl: url => listeners.forEach(fn => fn({ url })),
    now: () => 1000,
    storage: {
      getLocale: async () => 'en-GB',
      getAnalyticsConsent: async () => stored.consent,
      setAnalyticsConsent: async (analytics, atMs) => {
        stored.consent = { v: 1, analytics, atMs };
      },
      getBest: async () => stored.best,
      setBest: async score => {
        stored.best = score;
      },
    },
    analytics: {
      track: async e => {
        events.push({ name: e.name, params: e.params });
      },
      setCollectionEnabled: async () => undefined,
      recordError: (_err, code) => {
        errors.push(code);
      },
    },
    identity: {
      deviceUniqueId: async () => 'device-1',
      playerIdOf: async () => 'ABCD1234',
      isTestInstall: async () => options.testInstall ?? false,
      appVersion: () => '1.0.0 (1)',
    },
    linking: {
      getInitialURL: async () => options.initialUrl ?? null,
      addEventListener: ((_: 'url', fn: (e: { url: string }) => void) => {
        listeners.add(fn);
        return { remove: () => listeners.delete(fn) };
      }) as never,
    },
  };
}
