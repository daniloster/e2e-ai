// Language suggestion logic, dismissal persistence and storage failures on the real Layout.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Layout } from '../layout/Layout';
import { SITE_PAGES, createRenderContext } from '../pages';
import {
  SITE_LOCALE_KEY,
  localeOfLanguageTag,
  mountLocaleSuggestion,
  readLocalePrefs,
  suggestedLocale,
  writeLocalePrefs,
} from './localeSuggest';

function renderHome(locale: Locale = 'en-GB'): void {
  document.body.innerHTML = renderToStaticMarkup(
    createElement(Layout, {
      t: createSiteTranslator(locale),
      ctx: createRenderContext(locale, SITE_PAGES),
      current: 'home',
      children: createElement('p', null, 'x'),
    }),
  );
}

function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(SITE_LOCALE_KEY, initial);
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
    throw new Error('blocked');
  },
};

const bar = (locale: string) =>
  document.querySelector<HTMLElement>(`[data-locale-suggestion="${locale}"]`)!;
const dismiss = (locale: string) =>
  bar(locale).querySelector<HTMLButtonElement>('[data-locale-dismiss]')!;

beforeEach(() => {
  renderHome();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('localeOfLanguageTag', () => {
  it('maps by primary subtag, case-insensitively', () => {
    expect(localeOfLanguageTag('en-GB')).toBe('en-GB');
    expect(localeOfLanguageTag('EN-gb')).toBe('en-GB');
    expect(localeOfLanguageTag('es-419')).toBe('es');
    expect(localeOfLanguageTag('pt-BR')).toBe('pt-BR');
    expect(localeOfLanguageTag('pt-PT')).toBe('pt-BR');
    expect(localeOfLanguageTag('PT')).toBe('pt-BR');
  });

  it('returns null for anything else', () => {
    for (const tag of ['fr-FR', '', 'eng', 'e', 'constructor', 'toString', '-en']) {
      expect(localeOfLanguageTag(tag)).toBeNull();
    }
  });
});

describe('suggestedLocale', () => {
  it('suggests the first supported language when it is not the page locale', () => {
    expect(suggestedLocale('en-GB', ['pt-BR', 'en-GB'], { dismissed: [] })).toBe('pt-BR');
    expect(suggestedLocale('en-GB', ['pt-BR', 'en-GB'], { dismissed: ['pt-BR'] })).toBeNull();
    expect(suggestedLocale('pt-BR', ['pt-PT', 'en-GB'], { dismissed: [] })).toBeNull();
  });

  it('skips unsupported languages and needs one supported', () => {
    expect(suggestedLocale('en-GB', ['fr-FR', 'es-419'], { dismissed: [] })).toBe('es');
    expect(suggestedLocale('en-GB', [], { dismissed: [] })).toBeNull();
    expect(suggestedLocale('en-GB', ['fr'], { dismissed: [] })).toBeNull();
    expect(suggestedLocale('es', ['en-US', 'es'], { dismissed: ['pt-BR'] })).toBe('en-GB');
  });
});

describe('readLocalePrefs and writeLocalePrefs', () => {
  it('keeps only known locales, deduplicated and frozen', () => {
    const prefs = readLocalePrefs(memoryStorage('{"dismissed":["pt-BR","pt-BR","fr",1]}'));
    expect(prefs).toEqual({ dismissed: ['pt-BR'] });
    expect(Object.isFrozen(prefs)).toBe(true);
    expect(Object.isFrozen(prefs.dismissed)).toBe(true);
  });

  it('reads no dismissals when unset, corrupt, the wrong shape or unreadable', () => {
    for (const text of [undefined, '{', '[]', 'null', '1', '{"dismissed":"es"}', '{}']) {
      expect(readLocalePrefs(memoryStorage(text))).toEqual({ dismissed: [] });
    }
    expect(readLocalePrefs(null)).toEqual({ dismissed: [] });
    expect(readLocalePrefs(throwing)).toEqual({ dismissed: [] });
  });

  it('stores the dismissals as JSON and swallows failures', () => {
    const storage = memoryStorage();
    writeLocalePrefs(storage, { dismissed: ['es'] });
    expect(storage.items.get(SITE_LOCALE_KEY)).toBe('{"dismissed":["es"]}');
    expect(() => writeLocalePrefs(null, { dismissed: [] })).not.toThrow();
    expect(() => writeLocalePrefs(throwing, { dismissed: [] })).not.toThrow();
  });
});

describe('mountLocaleSuggestion', () => {
  it('reveals the suggestion without moving focus, then remembers the dismissal', () => {
    const storage = memoryStorage();
    const skip = document.querySelector<HTMLElement>('a[href="#main"]')!;
    skip.focus();
    mountLocaleSuggestion(document, { pageLocale: 'en-GB', languages: ['pt-BR'], storage });
    expect(bar('pt-BR').hidden).toBe(false);
    expect(bar('es').hidden).toBe(true);
    expect(document.activeElement).toBe(skip);

    expect(dismiss('pt-BR').textContent).toBe('Agora não');
    dismiss('pt-BR').click();
    expect(bar('pt-BR').hidden).toBe(true);
    expect(storage.items.get(SITE_LOCALE_KEY)).toBe('{"dismissed":["pt-BR"]}');
    expect(document.activeElement).toBe(skip);

    renderHome();
    mountLocaleSuggestion(document, { pageLocale: 'en-GB', languages: ['pt-BR'], storage });
    expect(bar('pt-BR').hidden).toBe(true);
    expect(bar('es').hidden).toBe(true);
  });

  it('moves focus to #main when focus was inside the dismissed bar', () => {
    mountLocaleSuggestion(document, {
      pageLocale: 'en-GB',
      languages: ['es-MX'],
      storage: memoryStorage(),
    });
    dismiss('es').focus();
    dismiss('es').click();
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('appends to earlier dismissals without duplicates', () => {
    const storage = memoryStorage('{"dismissed":["es"]}');
    mountLocaleSuggestion(document, { pageLocale: 'en-GB', languages: ['pt'], storage });
    dismiss('pt-BR').click();
    dismiss('pt-BR').click();
    expect(storage.items.get(SITE_LOCALE_KEY)).toBe('{"dismissed":["es","pt-BR"]}');
  });

  it('reveals nothing without a suggestion or without its markup', () => {
    mountLocaleSuggestion(document, {
      pageLocale: 'en-GB',
      languages: ['en-US', 'es'],
      storage: null,
    });
    mountLocaleSuggestion(document, { pageLocale: 'en-GB', languages: [], storage: null });
    expect(document.querySelectorAll('[data-locale-suggestion]:not([hidden])')).toHaveLength(0);
    document.body.innerHTML = '<main id="main"></main>';
    expect(() =>
      mountLocaleSuggestion(document, { pageLocale: 'en-GB', languages: ['es'], storage: null }),
    ).not.toThrow();
  });

  it('still shows and dismisses when every storage method throws', () => {
    expect(() =>
      mountLocaleSuggestion(document, {
        pageLocale: 'en-GB',
        languages: ['es'],
        storage: throwing,
      }),
    ).not.toThrow();
    expect(bar('es').hidden).toBe(false);
    expect(() => dismiss('es').click()).not.toThrow();
    expect(bar('es').hidden).toBe(true);
  });

  it('never throws on a broken document', () => {
    const broken = {
      querySelector: () => {
        throw new Error('boom');
      },
    } as unknown as Document;
    expect(() =>
      mountLocaleSuggestion(broken, { pageLocale: 'en-GB', languages: ['es'], storage: null }),
    ).not.toThrow();
  });
});
