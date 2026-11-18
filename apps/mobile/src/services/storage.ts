// Typed, corruption-safe AsyncStorage access (`pn.` prefix). The only file in the app that imports
// AsyncStorage. Reads never reject; an entry with the wrong shape is removed so it is not re-read.
// Object values carry a version (`v: 1`): a new shape gets a new version and a migration here,
// never a reinterpretation of an old one.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isLocale } from '../app/i18n';
import type { Locale } from '../app/i18n';

export const STORAGE_KEYS = {
  /** The language chosen in the app; unset follows the device. */
  locale: 'pn.locale',
  /** The device unique ID behind the player ID (services/identity.ts). */
  deviceId: 'pn.deviceId',
  /** The usage statistics and crash reports choice (`{ v: 1, analytics, atMs }`); unset means not asked. */
  analyticsConsent: 'pn.analyticsConsent',
  /** The best score on this device (`{ v: 1, score, atMs }`). */
  best: 'pn.best',
} as const;

export interface StoredAnalyticsConsent {
  v: 1;
  analytics: boolean;
  atMs: number;
}

export interface StoredBest {
  v: 1;
  score: number;
  atMs: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function warn(action: string, key: string): void {
  // The key only: values may hold personal data.
  if (__DEV__) console.warn(`[storage] ${action} failed for ${key}`);
}

async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    warn('removeItem', key);
  }
}

/** Never rejects. `parse` returns null for a wrong shape, which removes the key. */
async function readJson<T>(
  key: string,
  parse: (v: unknown) => T | null,
): Promise<T | null> {
  let text: string | null;
  try {
    text = await AsyncStorage.getItem(key);
  } catch {
    warn('getItem', key);
    return null;
  }
  if (text === null) return null;
  let value: T | null = null;
  try {
    value = parse(JSON.parse(text));
  } catch {
    value = null;
  }
  if (value === null) await remove(key);
  return value;
}

/** Never rejects: a failed write is logged in development and otherwise dropped. */
async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    warn('setItem', key);
  }
}

export function getLocale(): Promise<Locale | null> {
  return readJson(STORAGE_KEYS.locale, v => (isLocale(v) ? v : null));
}

export function setLocale(locale: Locale): Promise<void> {
  return writeJson(STORAGE_KEYS.locale, locale);
}

const DEVICE_ID = /^[A-Za-z0-9-]{1,128}$/;

export function getDeviceId(): Promise<string | null> {
  return readJson(STORAGE_KEYS.deviceId, v =>
    typeof v === 'string' && DEVICE_ID.test(v) ? v : null,
  );
}

export function setDeviceId(id: string): Promise<void> {
  return writeJson(STORAGE_KEYS.deviceId, id);
}

export function getAnalyticsConsent(): Promise<StoredAnalyticsConsent | null> {
  return readJson<StoredAnalyticsConsent>(STORAGE_KEYS.analyticsConsent, v => {
    if (!isPlainObject(v) || v.v !== 1) return null;
    if (typeof v.analytics !== 'boolean' || !isFiniteNumber(v.atMs))
      return null;
    return { v: 1, analytics: v.analytics, atMs: v.atMs };
  });
}

export function setAnalyticsConsent(
  analytics: boolean,
  atMs: number,
): Promise<void> {
  const value: StoredAnalyticsConsent = { v: 1, analytics, atMs };
  return writeJson(STORAGE_KEYS.analyticsConsent, value);
}

export async function getBest(): Promise<number | null> {
  const best = await readJson<StoredBest>(STORAGE_KEYS.best, v => {
    if (!isPlainObject(v) || v.v !== 1) return null;
    if (!isFiniteNumber(v.score) || v.score < 0 || !isFiniteNumber(v.atMs))
      return null;
    return { v: 1, score: v.score, atMs: v.atMs };
  });
  return best?.score ?? null;
}

export function setBest(score: number, atMs: number): Promise<void> {
  const value: StoredBest = { v: 1, score, atMs };
  return writeJson(STORAGE_KEYS.best, value);
}
