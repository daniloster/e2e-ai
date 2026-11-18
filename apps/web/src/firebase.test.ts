import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appFails: false,
  initializeApp: vi.fn((config: unknown) => ({ config })),
  isSupported: vi.fn(() => Promise.resolve(true)),
  getAnalytics: vi.fn(() => ({ kind: 'analytics' })),
  initializeAnalytics: vi.fn(() => ({ kind: 'debug-analytics' })),
  logEvent: vi.fn(),
}));

vi.mock('firebase/analytics', () => ({
  isSupported: mocks.isSupported,
  getAnalytics: mocks.getAnalytics,
  initializeAnalytics: mocks.initializeAnalytics,
  logEvent: mocks.logEvent,
}));

// Fresh modules per test, so the module-level handle starts empty.
// firebase/app is re-mocked on every load so a test can make the CDN import fail.
async function loadFacade() {
  vi.resetModules();
  vi.doMock('firebase/app', () => {
    if (mocks.appFails) throw new Error('gstatic blocked');
    return { initializeApp: mocks.initializeApp };
  });
  const facade = await import('./firebase');
  const { track } = await import('./analytics');
  return {
    initFirebase: () => facade.initFirebase(CONFIGURED),
    initUnconfigured: () => facade.initFirebase(),
    track,
  };
}

// A filled-in web config, so the tests exercise the SDK path the committed placeholders skip.
const CONFIGURED = {
  apiKey: 'test-key',
  authDomain: 'pocket-notes.firebaseapp.com',
  projectId: 'pocket-notes',
  storageBucket: 'pocket-notes.firebasestorage.app',
  messagingSenderId: '1',
  appId: '1:1:web:1',
  measurementId: 'G-TEST',
} as const;

const RESUMED = { name: 'consent_choice', params: { analytics: true } } as const;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appFails = false;
  mocks.isSupported.mockImplementation(() => Promise.resolve(true));
  mocks.logEvent.mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initFirebase and track', () => {
  it('initialises the app and Analytics, then logs events', async () => {
    const { initFirebase, track } = await loadFacade();
    await initFirebase();
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp.mock.calls[0]![0]).toMatchObject({
      projectId: 'pocket-notes',
      measurementId: 'G-TEST',
    });
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(1);
    track(RESUMED);
    expect(mocks.logEvent).toHaveBeenCalledTimes(1);
    expect(mocks.logEvent.mock.calls[0]!.slice(-2)).toEqual([
      'consent_choice',
      { analytics: true },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('loads nothing while the committed config still holds REPLACE_ME', async () => {
    const { initUnconfigured, track } = await loadFacade();
    await expect(initUnconfigured()).resolves.toBeUndefined();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    track(RESUMED);
    expect(mocks.logEvent).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips Analytics when it is unsupported', async () => {
    mocks.isSupported.mockImplementation(() => Promise.resolve(false));
    const { initFirebase, track } = await loadFacade();
    await initFirebase();
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
    expect(track(RESUMED)).toBeUndefined();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it('survives a failed CDN load with one warning', async () => {
    mocks.appFails = true;
    const { initFirebase, track } = await loadFacade();
    await expect(initFirebase()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Firebase');
    track(RESUMED);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it('uses debug mode with ?debug=1', async () => {
    window.history.replaceState(null, '', '/?debug=1');
    const { initFirebase } = await loadFacade();
    await initFirebase();
    expect(mocks.initializeAnalytics).toHaveBeenCalledWith(expect.anything(), {
      config: { debug_mode: true },
    });
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
  });

  it('is idempotent', async () => {
    const { initFirebase } = await loadFacade();
    const first = initFirebase();
    expect(initFirebase()).toBe(first);
    await first;
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
  });

  it('drops events sent before init finishes', async () => {
    const { initFirebase, track } = await loadFacade();
    const pending = initFirebase();
    expect(() => track(RESUMED)).not.toThrow();
    expect(mocks.logEvent).not.toHaveBeenCalled();
    await pending;
  });

  it('never throws when logEvent throws', async () => {
    mocks.logEvent.mockImplementation(() => {
      throw new Error('boom');
    });
    const { initFirebase, track } = await loadFacade();
    await initFirebase();
    expect(() => track(RESUMED)).not.toThrow();
  });

  it('logs events to the console in development', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { track } = await loadFacade();
    track(RESUMED);
    expect(debug).toHaveBeenCalledWith('[analytics]', 'consent_choice', { analytics: true });
  });
});

describe('isFirebaseConfigured', () => {
  it('is false for the committed placeholders and true once every value is set', async () => {
    const { FIREBASE_WEB_CONFIG, isFirebaseConfigured } = await import('./firebase');
    expect(isFirebaseConfigured()).toBe(false);
    expect(isFirebaseConfigured(FIREBASE_WEB_CONFIG)).toBe(false);
    expect(isFirebaseConfigured(CONFIGURED)).toBe(true);
    expect(isFirebaseConfigured({ ...CONFIGURED, appId: '' })).toBe(false);
  });
});
