// Facade over @react-native-firebase/analytics and /crashlytics: the only file in the app that
// imports RNFirebase. Every function swallows Firebase failures (including a missing or placeholder
// Firebase configuration) and sends no user text. Nothing is sent until the user allows usage
// statistics (setCollectionEnabled); firebase.json keeps both SDKs off at native startup.
import {
  getAnalytics,
  logEvent,
  setAnalyticsCollectionEnabled,
} from '@react-native-firebase/analytics';
import {
  crash,
  deleteUnsentReports,
  getCrashlytics,
  log,
  recordError as rnfbRecordError,
  setCrashlyticsCollectionEnabled,
} from '@react-native-firebase/crashlytics';

export type ScreenName = 'home' | 'play' | 'settings' | 'signin' | 'notes';
/** Where an error happened: a stable id, never text. */
export type ErrorArea =
  'app' | 'storage' | 'game' | 'identity' | 'link' | 'share';

export type AnalyticsEvent =
  | { name: 'screen'; params: { screen: ScreenName } }
  | { name: 'game_start'; params: { source: 'new' | 'link'; blocks: number } }
  | { name: 'game_cleared'; params: { moves: number; score: number } }
  | { name: 'game_shared'; params: { blocks: number } }
  | { name: 'link_opened'; params: { result: 'ok' | 'invalid' } }
  | { name: 'consent_choice'; params: { granted: boolean } }
  | {
      name: 'app_error';
      params: { code: string; area: ErrorArea; fatal: false };
    };

/** Static identifiers only, e.g. "screen:play", never user text. */
export type Breadcrumb = string;

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,100}$/;
const INVALID = 'invalid';
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const QUERY_PATTERN = /\?\S*/g;
const MAX_TEXT = 100;

let warned = false;
/** The user allowed usage statistics and crash reports; false until setCollectionEnabled(true). */
let collecting = false;

function warnOnce(what: string, error: unknown): void {
  if (!__DEV__ || warned) return;
  warned = true;
  console.warn(
    `[analytics] Firebase ${what} failed; continuing without it.`,
    error,
  );
}

export function isCollecting(): boolean {
  return collecting;
}

/** Never rejects. Dropped unless the user allowed usage statistics. */
export async function track(e: AnalyticsEvent): Promise<void> {
  if (__DEV__) console.debug('[analytics]', e.name, e.params);
  if (!collecting) return;
  try {
    await logEvent(getAnalytics(), e.name as string, e.params);
  } catch (error) {
    warnOnce('logEvent', error);
  }
}

function safeIdentifier(b: string): string {
  if (IDENTIFIER.test(b)) return b;
  if (__DEV__)
    console.warn(
      '[analytics] value is not a static identifier; sent as invalid.',
    );
  return INVALID;
}

/** Never throws. Text that is not a static identifier is never sent; nothing is without consent. */
export function breadcrumb(b: Breadcrumb): void {
  if (!collecting) return;
  try {
    log(getCrashlytics(), safeIdentifier(b));
  } catch (error) {
    warnOnce('log', error);
  }
}

/**
 * Never throws. Records a sanitised copy of `err` in Crashlytics as a non-fatal AND logs an
 * `app_error` analytics event `{code, area, fatal: false}`. `code` is a stable id such as
 * "storage.read" or "game.reduce"; neither field ever carries the error text.
 */
export function recordError(err: unknown, code: string, area: ErrorArea): void {
  if (!collecting) return;
  const safeCode = safeIdentifier(code);
  breadcrumb(`${area}:${safeCode}`);
  try {
    rnfbRecordError(getCrashlytics(), sanitizedError(err));
  } catch (error) {
    warnOnce('recordError', error);
  }
  void track({
    name: 'app_error',
    params: { code: safeCode, area, fatal: false },
  });
}

function sanitizedError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(`NonError: ${typeof err}`);
  const message = sanitizeText(err.message);
  const safe = new Error(message);
  safe.name = err.name;
  const firstLine = `${err.name}: ${message}`;
  safe.stack = err.stack
    ? [firstLine, ...err.stack.split('\n').slice(1)].join('\n')
    : firstLine;
  return safe;
}

/** URLs, then queries, then whitespace, then truncation. Exported for tests only. */
export function sanitizeText(raw: string): string {
  return raw
    .replace(URL_PATTERN, '[url]')
    .replace(QUERY_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * Applies the user's choice to both SDKs, which persist it natively. Never rejects; both SDKs are
 * attempted even if one fails. Turning collection off also deletes crash reports not yet sent.
 */
export async function setCollectionEnabled(enabled: boolean): Promise<void> {
  // Synchronous, so no event slips through while the SDK calls are pending.
  collecting = enabled;
  try {
    await setAnalyticsCollectionEnabled(getAnalytics(), enabled);
  } catch (error) {
    warnOnce('setAnalyticsCollectionEnabled', error);
  }
  try {
    await setCrashlyticsCollectionEnabled(getCrashlytics(), enabled);
  } catch (error) {
    warnOnce('setCrashlyticsCollectionEnabled', error);
  }
  if (enabled) return;
  try {
    await deleteUnsentReports(getCrashlytics());
  } catch (error) {
    warnOnce('deleteUnsentReports', error);
  }
}

/** __DEV__ only: crashes natively so Crashlytics can be verified. */
export function triggerTestCrash(): void {
  if (!__DEV__) return;
  crash(getCrashlytics());
}
