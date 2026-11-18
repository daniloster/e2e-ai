// The site language switch: three locale links, hreflang, lang and aria-current.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import type { SitePageId } from '../config';
import { SITE_PAGES, createRenderContext, type SitePageDef } from '../pages';
import { LanguageSwitch } from './LanguageSwitch';

const rulesFixture: SitePageDef = {
  id: 'faq',
  template: 'rules.html',
  slug: 'faq',
  titleKey: 'site.meta.defaultTitle',
  descriptionKey: 'site.meta.defaultDescription',
  render: () => createElement('main'),
};
const fixture: readonly SitePageDef[] = [SITE_PAGES[0] as SitePageDef, rulesFixture];

function render(locale: Locale, current: SitePageId) {
  const html = renderToStaticMarkup(
    <LanguageSwitch
      t={createSiteTranslator(locale)}
      ctx={createRenderContext(locale, fixture)}
      current={current}
    />,
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = [...doc.querySelectorAll('nav > ul > li > a')];
  return { doc, links };
}

describe('LanguageSwitch', () => {
  it('links the same page in each locale and marks the page locale', () => {
    const { links } = render('es', 'faq');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/faq', '/es/faq', '/pt-br/faq']);
    expect(links.map((a) => a.getAttribute('hreflang'))).toEqual(['en-GB', 'es', 'pt-BR']);
    expect(links.map((a) => a.getAttribute('lang'))).toEqual(['en-GB', 'es', 'pt-BR']);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it.each<Locale>(['en-GB', 'es', 'pt-BR'])('shows the endonyms in %s', (locale) => {
    const { links } = render(locale, 'faq');
    expect(links.map((a) => a.textContent)).toEqual(['English', 'Español', 'Português (Brasil)']);
  });

  it('labels the nav in the page locale', () => {
    expect(render('es', 'home').doc.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Idioma',
    );
    expect(render('en-GB', 'home').doc.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Language',
    );
  });

  it('links the home roots and marks pt-BR current on a pt-BR home', () => {
    const { links } = render('pt-BR', 'home');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/es/', '/pt-br/']);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
  });
});
