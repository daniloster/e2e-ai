import { describe, expect, it } from 'vitest';

import { enGB } from './en-GB';
import { es } from './es';
import { ptBR } from './pt-BR';

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
const MAX_CODE_POINTS = 160;

type Catalog = Readonly<Record<string, string>>;
const catalogs: Record<string, Catalog> = { 'en-GB': enGB, es, 'pt-BR': ptBR };

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
  ['es', es],
  ['pt-BR', ptBR],
] as const)('%s catalog', (locale, catalog) => {
  it('has exactly the en-GB keys', () => {
    const diff = keyDiff(enGB, catalog);
    expect(
      diff,
      `${locale}: missing ${diff.missing.join(', ')}; extra ${diff.extra.join(', ')}`,
    ).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('uses the same placeholders as en-GB for every key', () => {
    const mismatches = Object.entries(enGB)
      .map(([key, value]) => ({
        key,
        en: placeholders(value),
        other: placeholders((catalog as Catalog)[key] ?? ''),
      }))
      .filter((m) => m.en.join() !== m.other.join())
      .map((m) => `${m.key}: en-GB {${m.en.join(',')}} vs ${locale} {${m.other.join(',')}}`);
    expect(mismatches).toEqual([]);
  });

  it('starts with a "// Reviewed by:" header', () => {
    const file = locale === 'es' ? './es.ts' : './pt-BR.ts';
    const firstLine = (sources[file] ?? '').split('\n')[0] ?? '';
    expect(firstLine).toMatch(/^\/\/ Reviewed by: .+/);
  });
});

describe('all catalogs', () => {
  it(`keep every value within ${MAX_CODE_POINTS} code points`, () => {
    const tooLong = Object.entries(catalogs).flatMap(([locale, catalog]) =>
      Object.entries(catalog)
        .filter(([, value]) => Array.from(value).length > MAX_CODE_POINTS)
        .map(([key, value]) => `${locale} ${key}: ${Array.from(value).length}`),
    );
    expect(tooLong).toEqual([]);
  });

  it('contain no unfinished markers or empty values', () => {
    const bad = Object.entries(catalogs).flatMap(([locale, catalog]) =>
      Object.entries(catalog)
        .filter(([, value]) => value.trim() === '' || /T[O]DO|T[B]D|\?{3}/.test(value))
        .map(([key]) => `${locale} ${key}`),
    );
    expect(bad).toEqual([]);
  });
});
