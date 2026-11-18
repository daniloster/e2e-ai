// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CONSENT_KEY, CONSENT_TTL_MS, consentState, readConsent, writeConsent } from './consent';

function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(CONSENT_KEY, initial);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('quota');
  },
};

describe('constants', () => {
  it('uses the pn.consent key and a 365-day window', () => {
    expect(CONSENT_KEY).toBe('pn.consent');
    expect(CONSENT_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

describe('writeConsent and readConsent', () => {
  it('round-trips a grant and a refusal', () => {
    const s = memoryStorage();
    writeConsent(s, true, 1000);
    expect(JSON.parse(s.getItem('pn.consent')!)).toEqual({ v: 1, analytics: true, atMs: 1000 });
    expect(consentState(readConsent(s, 2000), 2000)).toBe('granted');
    writeConsent(s, false, 1000);
    expect(JSON.parse(s.getItem('pn.consent')!)).toEqual({ v: 1, analytics: false, atMs: 1000 });
    expect(consentState(readConsent(s, 2000), 2000)).toBe('denied');
  });

  it('returns null when unset', () => {
    expect(readConsent(memoryStorage(), 0)).toBeNull();
  });

  it('returns null for invalid JSON or an invalid record', () => {
    for (const text of [
      '{',
      'null',
      '[]',
      '"granted"',
      '{"v":2,"analytics":true,"atMs":1}',
      '{"v":1,"analytics":"yes","atMs":1}',
      '{"v":1,"analytics":true,"atMs":"1"}',
      '{"v":1,"analytics":true}',
    ]) {
      expect(readConsent(memoryStorage(text), 0)).toBeNull();
    }
  });

  it('drops extra keys and freezes the record', () => {
    const record = readConsent(memoryStorage('{"v":1,"analytics":false,"atMs":5,"extra":1}'), 0);
    expect(record).toEqual({ v: 1, analytics: false, atMs: 5 });
    expect(Object.keys(record!).sort()).toEqual(['analytics', 'atMs', 'v']);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('never writes while reading, and keeps corrupt JSON stored', () => {
    const s = memoryStorage('{');
    readConsent(s, 0);
    expect(s.items.get(CONSENT_KEY)).toBe('{');
  });

  it('survives throwing and missing storage', () => {
    expect(readConsent(throwing, 0)).toBeNull();
    expect(() => writeConsent(throwing, true, 0)).not.toThrow();
    expect(readConsent(null, 0)).toBeNull();
    expect(() => writeConsent(null, true, 0)).not.toThrow();
  });
});

describe('consentState', () => {
  const now = 10 * CONSENT_TTL_MS;

  it('is unknown without a record', () => {
    expect(consentState(null, now)).toBe('unknown');
  });

  it('is valid up to exactly 365 days, then unknown', () => {
    expect(consentState({ v: 1, analytics: true, atMs: now - CONSENT_TTL_MS }, now)).toBe(
      'granted',
    );
    expect(consentState({ v: 1, analytics: true, atMs: now - CONSENT_TTL_MS - 1 }, now)).toBe(
      'unknown',
    );
    expect(consentState({ v: 1, analytics: false, atMs: now - CONSENT_TTL_MS - 1 }, now)).toBe(
      'unknown',
    );
  });

  it('is unknown for a record dated in the future', () => {
    expect(consentState({ v: 1, analytics: true, atMs: now + 1 }, now)).toBe('unknown');
  });

  it('maps analytics to granted or denied', () => {
    expect(consentState({ v: 1, analytics: true, atMs: now }, now)).toBe('granted');
    expect(consentState({ v: 1, analytics: false, atMs: now }, now)).toBe('denied');
  });
});
