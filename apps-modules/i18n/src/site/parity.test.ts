// Site catalog parity: same keys and placeholders as en-GB, review headers, main catalogs free of site.*.
import { describe, expect, it } from 'vitest';

import { CATALOGS } from '../translator';
import type { Catalog } from '../types';
import { siteEnGB } from './en-GB';
import { siteEs } from './es';
import { sitePtBR } from './pt-BR';

declare global {
  interface ImportMeta {
    glob<T>(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, T>;
  }
}

const sources = import.meta.glob<string>('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function keyDiff(base: Catalog, other: Catalog) {
  const baseKeys = new Set(Object.keys(base));
  const otherKeys = new Set(Object.keys(other));
  return {
    missing: [...baseKeys].filter((k) => !otherKeys.has(k)),
    extra: [...otherKeys].filter((k) => !baseKeys.has(k)),
  };
}

function placeholders(value: string): string[] {
  return [...new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (m) => m[1]!))].sort();
}

describe.each([
  ['es', siteEs],
  ['pt-BR', sitePtBR],
] as const)('site %s catalog', (locale, catalog) => {
  it('has exactly the en-GB keys', () => {
    const diff = keyDiff(siteEnGB, catalog);
    expect(
      diff,
      `${locale}: missing ${diff.missing.join(', ')}; extra ${diff.extra.join(', ')}`,
    ).toEqual({ missing: [], extra: [] });
  });

  it('uses the same placeholders as en-GB for every key', () => {
    const mismatches = Object.entries(siteEnGB)
      .map(([key, value]) => ({
        key,
        en: placeholders(value),
        other: placeholders((catalog as Catalog)[key] ?? ''),
      }))
      .filter((m) => m.en.join() !== m.other.join())
      .map((m) => `${m.key}: en {${m.en.join(',')}} vs ${locale} {${m.other.join(',')}}`);
    expect(mismatches).toEqual([]);
  });

  it('starts with a "// Reviewed by:" header', () => {
    const file = locale === 'es' ? './es.ts' : './pt-BR.ts';
    const firstLine = (sources[file] ?? '').split('\n')[0] ?? '';
    expect(firstLine).toMatch(/^\/\/ Reviewed by: .+/);
  });
});

describe('main catalogs', () => {
  it('hold no site.* key', () => {
    const offenders = (['en-GB', 'es', 'pt-BR'] as const).flatMap((locale) =>
      Object.keys(CATALOGS[locale])
        .filter((key) => key.startsWith('site.'))
        .map((key) => `${locale} ${key}`),
    );
    expect(offenders).toEqual([]);
  });
});
