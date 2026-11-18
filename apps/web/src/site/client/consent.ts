// The pn.consent record: read, write, decide. Storage is always passed in. Never throws.
export interface ConsentRecord {
  v: 1;
  analytics: boolean;
  atMs: number;
}

export const CONSENT_KEY = 'pn.consent';
export const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type ConsentState = 'unknown' | 'granted' | 'denied';

function parseConsent(value: unknown): ConsentRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { v, analytics, atMs } = value as Record<string, unknown>;
  if (v !== 1 || typeof analytics !== 'boolean') return null;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;
  return Object.freeze<ConsentRecord>({ v: 1, analytics, atMs });
}

/** null when unset, unreadable, corrupt or invalid (v !== 1, wrong types). Frozen, extra keys dropped. Never writes. */
export function readConsent(
  storage: Pick<Storage, 'getItem'> | null,
  nowMs: number,
): ConsentRecord | null {
  // Part of the SPEC signature; expiry is decided by consentState so an old record stays readable.
  void nowMs;
  if (storage === null) return null;
  let text: string | null;
  try {
    text = storage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    return parseConsent(JSON.parse(text));
  } catch {
    // Corrupt JSON stays stored; the next choice overwrites it.
    return null;
  }
}

/** Stores { v: 1, analytics, atMs: nowMs } as JSON; a null, blocked or full storage is ignored. */
export function writeConsent(
  storage: Pick<Storage, 'setItem'> | null,
  analytics: boolean,
  nowMs: number,
): void {
  if (storage === null) return;
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics, atMs: nowMs }));
  } catch {
    // The choice still applies for this page view.
  }
}

/** unknown: null, older than CONSENT_TTL_MS, or dated in the future (clock moved back). */
export function consentState(record: ConsentRecord | null, nowMs: number): ConsentState {
  if (record === null) return 'unknown';
  const age = nowMs - record.atMs;
  if (age < 0 || age > CONSENT_TTL_MS) return 'unknown';
  return record.analytics ? 'granted' : 'denied';
}
