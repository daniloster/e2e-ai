// Consent banner behaviour on the real Layout markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Layout } from '../layout/Layout';
import { SITE_PAGES, createRenderContext } from '../pages';
import { mountConsentBanner, type BannerDeps } from './banner';
import { CONSENT_KEY, type ConsentState } from './consent';

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

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    setItem: vi.fn((key: string, value: string) => {
      items.set(key, value);
    }),
  };
}

function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}
const banner = () => el('[data-consent-banner]');
const accept = () => el<HTMLButtonElement>('[data-consent="accept"]');
const decline = () => el<HTMLButtonElement>('[data-consent="decline"]');
const settings = () => el<HTMLButtonElement>('[data-consent-settings]');

function mount(state: ConsentState, storage: BannerDeps['storage'] = memoryStorage()) {
  const deps = { state, storage, now: () => 42, onGrant: vi.fn(), onRefuse: vi.fn() };
  mountConsentBanner(document, deps);
  return deps;
}

function stored(storage: ReturnType<typeof memoryStorage>): unknown {
  const text = storage.items.get(CONSENT_KEY);
  return text === undefined ? undefined : JSON.parse(text);
}

function escape(target: HTMLElement): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

beforeEach(() => {
  renderHome();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountConsentBanner', () => {
  it('does nothing when the markup is missing', () => {
    document.body.innerHTML = '<button data-consent-settings hidden></button>';
    expect(() => mount('unknown')).not.toThrow();
    expect(settings().hidden).toBe(true);
    document.body.innerHTML =
      '<section data-consent-banner hidden><button data-consent="accept"></button></section><button data-consent-settings hidden></button>';
    expect(() => mount('unknown')).not.toThrow();
    expect(banner().hidden).toBe(true);
    expect(settings().hidden).toBe(true);
  });

  it('reveals the banner and settings when unknown, without moving focus', () => {
    const before = document.activeElement;
    mount('unknown');
    expect(banner().hidden).toBe(false);
    expect(settings().hidden).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it.each<ConsentState>(['granted', 'denied'])('keeps the banner hidden when %s', (state) => {
    mount(state);
    expect(banner().hidden).toBe(true);
    expect(settings().hidden).toBe(false);
  });

  it('Allow stores the grant, hides the banner, then calls onGrant', () => {
    const storage = memoryStorage();
    const deps = mount('unknown', storage);
    deps.onGrant.mockImplementation(() => {
      expect(stored(storage)).toEqual({ v: 1, analytics: true, atMs: 42 });
      expect(banner().hidden).toBe(true);
    });
    accept().click();
    expect(deps.onGrant).toHaveBeenCalledTimes(1);
    expect(deps.onRefuse).not.toHaveBeenCalled();
  });

  it('No thanks stores the refusal, hides the banner, then calls onRefuse', () => {
    const storage = memoryStorage();
    const deps = mount('unknown', storage);
    deps.onRefuse.mockImplementation(() => {
      expect(stored(storage)).toEqual({ v: 1, analytics: false, atMs: 42 });
      expect(banner().hidden).toBe(true);
    });
    decline().click();
    expect(deps.onRefuse).toHaveBeenCalledTimes(1);
    expect(deps.onGrant).not.toHaveBeenCalled();
  });

  it('Escape inside the visible banner is No thanks; elsewhere it does nothing', () => {
    const storage = memoryStorage();
    const deps = mount('unknown', storage);
    escape(el('main'));
    expect(deps.onRefuse).not.toHaveBeenCalled();
    accept().focus();
    escape(accept());
    expect(stored(storage)).toEqual({ v: 1, analytics: false, atMs: 42 });
    expect(banner().hidden).toBe(true);
    expect(deps.onRefuse).toHaveBeenCalledTimes(1);
    escape(accept());
    expect(deps.onRefuse).toHaveBeenCalledTimes(1);
  });

  it('moves focus to #main after a choice made from the automatic show', () => {
    mount('unknown');
    decline().focus();
    decline().click();
    expect(document.activeElement).toBe(el('#main'));
  });

  it('leaves focus alone after a choice when focus was outside the banner', () => {
    mount('unknown');
    const play = el<HTMLAnchorElement>('a[href="/faq"]');
    play.focus();
    accept().click();
    expect(document.activeElement).toBe(play);
  });

  it('Cookie settings reopens the banner, focuses Allow, and gets focus back after a choice', () => {
    const storage = memoryStorage();
    const deps = mount('granted', storage);
    settings().focus();
    settings().click();
    expect(banner().hidden).toBe(false);
    expect(document.activeElement).toBe(accept());
    decline().click();
    expect(stored(storage)).toEqual({ v: 1, analytics: false, atMs: 42 });
    expect(banner().hidden).toBe(true);
    expect(document.activeElement).toBe(settings());
    expect(deps.onRefuse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a null storage', null],
    [
      'a throwing setItem',
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
    ],
  ])('still hides the banner and calls back with %s', (_case, storage) => {
    const deps = mount('unknown', storage);
    expect(() => accept().click()).not.toThrow();
    expect(banner().hidden).toBe(true);
    expect(deps.onGrant).toHaveBeenCalledTimes(1);
  });

  it('works on a translated page', () => {
    renderHome('pt-BR');
    mount('unknown');
    expect(accept().textContent).toBe('Permitir análise');
    expect(banner().hidden).toBe(false);
  });
});
