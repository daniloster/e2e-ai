// Facade over firebase/app + firebase/analytics. Loaded with dynamic import() only, so a
// blocked gstatic CDN in production never breaks a site page.
import type { Analytics, logEvent as LogEventFn } from 'firebase/analytics';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
}

interface AnalyticsHandle {
  analytics: Analytics;
  logEvent: typeof LogEventFn;
}

/** The marker every unset value carries until the Firebase web app is registered. */
export const UNCONFIGURED = 'REPLACE_ME';

// Firebase console > Project settings > Your apps > Web app. A Firebase web API key is a public
// identifier, restricted by HTTP referrer (add the production origin to its restrictions). Until
// every REPLACE_ME is filled, initFirebase() loads nothing and track() stays a no-op.
export const FIREBASE_WEB_CONFIG: FirebaseWebConfig = Object.freeze({
  apiKey: 'REPLACE_ME',
  authDomain: 'pocket-notes.firebaseapp.com',
  projectId: 'pocket-notes',
  storageBucket: 'pocket-notes.firebasestorage.app',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
  measurementId: 'REPLACE_ME',
});

/** False while any value is still a REPLACE_ME placeholder (or empty). */
export function isFirebaseConfigured(config: FirebaseWebConfig = FIREBASE_WEB_CONFIG): boolean {
  return Object.values(config).every(
    (value) => typeof value === 'string' && value !== '' && !value.includes(UNCONFIGURED),
  );
}

let initPromise: Promise<void> | null = null;
let handle: AnalyticsHandle | null = null;

async function load(config: FirebaseWebConfig): Promise<void> {
  // An unconfigured checkout (no Firebase project yet) never fetches the SDK.
  if (!isFirebaseConfigured(config)) return;
  try {
    const [{ initializeApp }, analyticsModule] = await Promise.all([
      import('firebase/app'),
      import('firebase/analytics'),
    ]);
    const app = initializeApp(config);
    if (!(await analyticsModule.isSupported())) return;
    const debug = new URLSearchParams(location.search).get('debug') === '1';
    const analytics = debug
      ? analyticsModule.initializeAnalytics(app, { config: { debug_mode: true } })
      : analyticsModule.getAnalytics(app);
    handle = { analytics, logEvent: analyticsModule.logEvent };
  } catch (error) {
    console.warn('Firebase failed to initialise; analytics is disabled.', error);
  }
}

/**
 * Idempotent and never rejects. One console.warn on any failure. `config` is a test seam;
 * production callers leave it out (FIREBASE_WEB_CONFIG).
 */
export function initFirebase(config: FirebaseWebConfig = FIREBASE_WEB_CONFIG): Promise<void> {
  initPromise ??= load(config);
  return initPromise;
}

/** Internal seam for analytics.ts. null until Analytics is ready, or forever if unsupported or failed. */
export function getAnalyticsHandle(): AnalyticsHandle | null {
  return handle;
}
