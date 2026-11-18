import { describe, expect, it } from 'vitest';

import { isLocale, negotiateLocale } from './negotiate';

describe('negotiateLocale', () => {
  it.each([
    [['es-MX'], 'es'],
    [['pt-PT'], 'pt-BR'],
    [['pt-BR', 'en'], 'pt-BR'],
    [['fr-FR', 'es-ES'], 'es'],
    [[], 'en-GB'],
    [['xx'], 'en-GB'],
    [['en-US', 'es'], 'en-GB'],
    [['en'], 'en-GB'],
    [['en-GB'], 'en-GB'],
    [['EN_au'], 'en-GB'],
    [['PT_br'], 'pt-BR'],
    [[' es '], 'es'],
    [['pt'], 'pt-BR'],
    [['', 'fr', 'de-DE'], 'en-GB'],
    [['constructor', '__proto__'], 'en-GB'],
  ] as const)('%j -> %s', (candidates, expected) => {
    expect(negotiateLocale(candidates)).toBe(expected);
  });

  it('skips non-string candidates without throwing', () => {
    expect(negotiateLocale([42 as unknown as string, 'es'])).toBe('es');
  });
});

describe('isLocale', () => {
  it('accepts exactly the supported locales', () => {
    for (const locale of ['en-GB', 'es', 'pt-BR']) expect(isLocale(locale)).toBe(true);
  });

  it.each(['en', 'en-gb', 'pt-br', 'pt', 'EN', '', null, 42, undefined])('rejects %j', (value) => {
    expect(isLocale(value)).toBe(false);
  });
});
