import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator, createTranslatorWith, CATALOGS, defaultWarn } from './translator';
import type { Catalog, Locale, MessageKey } from './types';
import { SUPPORTED_LOCALES } from './types';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Plurals and placeholders are tested on a fixture so the real catalogs can change freely.
const FIXTURE: Readonly<Record<Locale, Catalog>> = {
  'en-GB': {
    'f.ok': 'OK',
    'f.blocks_zero': 'No blocks',
    'f.blocks_one': '{count} block',
    'f.blocks_other': '{count} blocks',
    'f.seconds_one': '{count} second',
    'f.seconds_other': '{count} seconds',
    'f.from': 'From {player}',
  },
  es: {
    'f.ok': 'OK',
    'f.blocks_zero': 'Ningún bloque',
    'f.blocks_one': '{count} bloque',
    'f.blocks_other': '{count} bloques',
    'f.seconds_one': '{count} segundo',
    'f.seconds_other': '{count} segundos',
    'f.from': 'De {player}',
  },
  'pt-BR': {
    'f.ok': 'OK',
    'f.blocks_zero': 'Nenhum bloco',
    'f.blocks_one': '{count} bloco',
    'f.blocks_other': '{count} blocos',
    'f.seconds_one': '{count} segundo',
    'f.seconds_other': '{count} segundos',
    'f.from': 'De {player}',
  },
};
const k = (key: string) => key as MessageKey;
const fixture = (locale: Locale, warn = vi.fn()) => createTranslatorWith(locale, FIXTURE, warn);

describe('lookup', () => {
  it.each([
    ['en-GB', 'Back'],
    ['es', 'Volver'],
    ['pt-BR', 'Voltar'],
  ] as const)('%s: common.back', (locale, expected) => {
    expect(createTranslator(locale).t('common.back')).toBe(expected);
  });

  it('keeps the locale on the translator', () => {
    for (const locale of SUPPORTED_LOCALES) expect(createTranslator(locale).locale).toBe(locale);
  });
});

describe('plurals', () => {
  it.each([
    ['en-GB', '1 second', '2 seconds', '0 seconds'],
    ['es', '1 segundo', '2 segundos', '0 segundos'],
    ['pt-BR', '1 segundo', '2 segundos', '0 segundos'],
  ] as const)('%s: one / other', (locale, one, two, zero) => {
    const { t } = fixture(locale);
    expect(t(k('f.seconds'), { count: 1 })).toBe(one);
    expect(t(k('f.seconds'), { count: 2 })).toBe(two);
    expect(t(k('f.seconds'), { count: 0 })).toBe(zero);
  });

  it('uses the _zero form when it exists', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(fixture(locale).t(k('f.blocks'), { count: 0 })).toBe(FIXTURE[locale]['f.blocks_zero']);
    }
  });

  it('maps the many category to _other', () => {
    expect(fixture('es').t(k('f.seconds'), { count: 1_000_000 })).toBe('1000000 segundos');
  });

  it('uses _other for a plural key without count, and the bare key for a non-plural key with count', () => {
    const warn = vi.fn();
    const { t } = fixture('en-GB', warn);
    expect(t(k('f.seconds'), { count: 'x' as unknown as number })).toBe('x seconds');
    expect(t(k('f.ok'), { count: 3 })).toBe('OK');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('interpolation', () => {
  it('fills placeholders and never rescans substituted values', () => {
    const { t } = fixture('en-GB');
    expect(t(k('f.from'), { player: 'Ana' })).toBe('From Ana');
    expect(t(k('f.from'), { player: '{player}' })).toBe('From {player}');
  });

  it('leaves a missing param in place and warns once', () => {
    const warn = vi.fn();
    const { t } = fixture('en-GB', warn);
    expect(t(k('f.from'))).toBe('From {player}');
    t(k('f.from'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('player');
  });
});

describe('fallback', () => {
  const withoutOk = (): Readonly<Record<Locale, Catalog>> => ({
    ...CATALOGS,
    es: Object.fromEntries(Object.entries(CATALOGS.es).filter(([key]) => key !== 'common.ok')),
  });

  it('falls back to en-GB for a key missing in the locale and warns once', () => {
    const warn = vi.fn();
    const { t } = createTranslatorWith('es', withoutOk(), warn);
    expect([t('common.ok'), t('common.ok'), t('common.ok')]).toEqual(['OK', 'OK', 'OK']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('common.ok');
    expect(warn.mock.calls[0]![0]).toContain('es');
  });

  it('returns the key itself when no catalog has it', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(createTranslatorWith(locale, CATALOGS, vi.fn()).t(k('no.such.key'))).toBe(
        'no.such.key',
      );
    }
  });
});

describe('warnings', () => {
  it('stay silent in production builds', () => {
    const { console } = globalThis as unknown as { console: { warn: (m: string) => void } };
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    createTranslator('en-GB').t(k('no.such.key'));
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    defaultWarn('dev message');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('no Intl.PluralRules', () => {
  it('falls back to one/other', () => {
    const original = Intl.PluralRules;
    try {
      (Intl as { PluralRules?: unknown }).PluralRules = undefined;
      const { t } = fixture('en-GB');
      expect(t(k('f.seconds'), { count: 1 })).toBe('1 second');
      expect(t(k('f.seconds'), { count: 3 })).toBe('3 seconds');
    } finally {
      (Intl as { PluralRules?: unknown }).PluralRules = original;
    }
  });
});
