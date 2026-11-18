// The site chrome: focus order, nav current state, footer links per locale, copyright year.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { SITE_CATALOGS, createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import { SITE_LOCALES } from '../config';
import { SITE_PAGES, createRenderContext, type SitePageDef } from '../pages';
import { Footer } from './Footer';
import { Layout } from './Layout';

function parse(element: ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(element), 'text/html');
}

function layout(locale: Locale, pages: readonly SitePageDef[] = SITE_PAGES): Document {
  return parse(
    <Layout t={createSiteTranslator(locale)} ctx={createRenderContext(locale, pages)} current="faq">
      {createElement('p', null, 'x')}
    </Layout>,
  );
}

describe('Layout', () => {
  it('starts with the skip link, then the hidden consent banner', () => {
    const doc = layout('en-GB');
    const first = doc.body.firstElementChild!;
    expect(first.tagName).toBe('A');
    expect(first.getAttribute('href')).toBe('#main');
    expect(doc.querySelector('header [data-consent-banner]')?.hasAttribute('hidden')).toBe(true);
    const main = doc.querySelector('main#main')!;
    // The "still being built" notice opens every page, then the page body.
    expect(main.firstElementChild?.hasAttribute('data-building-notice')).toBe(true);
    expect(main.firstElementChild?.textContent).toBe(
      SITE_CATALOGS['en-GB']['site.notice.building'],
    );
    expect(main.textContent?.endsWith('x')).toBe(true);
  });

  it.each(SITE_LOCALES)('%s nav lists the content pages and marks the current one', (locale) => {
    const doc = layout(locale);
    const links = [...doc.querySelectorAll('nav[aria-label] ul a')].slice(0, 3);
    const copy = SITE_CATALOGS[locale];
    expect(links.map((a) => a.textContent)).toEqual([
      copy['site.nav.home'],
      copy['site.nav.faq'],
      copy['site.nav.contact'],
    ]);
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual([copy['site.nav.faq']]);
  });

  it('omits nav links to unregistered pages', () => {
    const doc = layout(
      'en-GB',
      SITE_PAGES.filter((p) => p.id !== 'contact'),
    );
    expect(doc.body.innerHTML).not.toContain('href="/contact"');
  });

  it('has no TV page link', () => {
    expect(layout('es').body.innerHTML).not.toContain('/play');
  });
});

describe('Footer', () => {
  it.each(SITE_LOCALES)('%s links contact, support and your data', (locale) => {
    const doc = parse(
      <Footer t={createSiteTranslator(locale)} ctx={createRenderContext(locale)} />,
    );
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      createRenderContext(locale).url('contact'),
      createRenderContext(locale).url('support'),
      createRenderContext(locale).url('yourData'),
    ]);
    expect(doc.body.textContent).toContain(`© ${new Date().getFullYear()} Pocket Notes`);
    expect(doc.querySelector('[data-consent-settings]')?.hasAttribute('hidden')).toBe(true);
  });
});
