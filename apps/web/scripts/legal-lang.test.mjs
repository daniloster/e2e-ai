// @vitest-environment jsdom
import { negotiateLocale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyLegalLocale,
  applySiteChrome,
  initLegalPage,
  LEGAL_LOCALES,
  localeFromTag,
  resolveLegalLocale,
} from '../public/legal.js';
// Vite's ?raw import: under jsdom import.meta.url is not a file: URL, so fileURLToPath cannot read it.
import NOT_FOUND_HTML from '../public/404.html?raw';

function fixture() {
  document.documentElement.lang = 'en-GB';
  document.title = 'Original';
  document.body.innerHTML = `
    <a id="skip" href="#main" data-i18n-en-gb="Skip to content" data-i18n-es="Saltar al contenido" data-i18n-pt-br="Pular para o conteúdo">Skip to content</a>
    <header>
      <nav id="menu" aria-label="Menu" data-label-en-gb="Menu" data-label-es="Menú" data-label-pt-br="Menu">
        <a id="faq" href="/faq" data-href-en-gb="/faq" data-href-es="/es/faq" data-href-pt-br="/pt-br/faq" data-i18n-en-gb="FAQ" data-i18n-es="Preguntas" data-i18n-pt-br="Dúvidas">FAQ</a>
        <a id="partial" href="/" data-i18n-en-gb="Home">Home</a>
      </nav>
    </header>
    <main data-legal-page="privacy">
      <nav data-legal-langs>
        <a href="?lang=en-GB" hreflang="en-GB">English</a>
        <a href="?lang=es" hreflang="es">Español</a>
        <a href="?lang=pt-BR" hreflang="pt-BR">Português</a>
      </nav>
      <article data-locale="en-GB" data-title="Privacy Policy">en</article>
      <article data-locale="es" data-title="Política de privacidad">es</article>
      <article data-locale="pt-BR" data-title="Política de Privacidade">pt</article>
    </main>
    <footer>
      <a id="privacy" href="/privacy?lang=en-GB" data-href-en-gb="/privacy?lang=en-GB" data-href-es="/privacy?lang=es" data-href-pt-br="/privacy?lang=pt-BR" data-i18n-en-gb="Privacy" data-i18n-es="Privacidad" data-i18n-pt-br="Privacidade">Privacy</a>
    </footer>`;
}

function byId(id) {
  return document.getElementById(id);
}

describe('resolveLegalLocale', () => {
  it('prefers ?lang=, then the browser, then en-GB', () => {
    expect(LEGAL_LOCALES).toEqual(['en-GB', 'es', 'pt-BR']);
    expect(Object.isFrozen(LEGAL_LOCALES)).toBe(true);
    expect(resolveLegalLocale('es', ['en-US'])).toBe('es');
    expect(resolveLegalLocale('pt-BR', [])).toBe('pt-BR');
    expect(resolveLegalLocale('PT_br', [])).toBe('pt-BR');
    expect(resolveLegalLocale('pt-PT', [])).toBe('pt-BR');
    expect(resolveLegalLocale(null, ['es-MX', 'en'])).toBe('es');
    expect(resolveLegalLocale(null, ['fr-FR'])).toBe('en-GB');
    expect(resolveLegalLocale('en-US', [])).toBe('en-GB');
    expect(resolveLegalLocale('en-GB', ['es'])).toBe('en-GB');
  });

  it.each([
    [['es-MX']],
    [['pt-PT']],
    [['pt-BR', 'en']],
    [['fr-FR', 'es-ES']],
    [[]],
    [['xx']],
    [['en-US', 'es']],
    [['PT_br']],
    [[' es ']],
    [['pt']],
    [['en-GB']],
    [['', 'fr', 'de-DE']],
  ])('matches negotiateLocale for %j', (candidates) => {
    expect(resolveLegalLocale(null, candidates)).toBe(negotiateLocale(candidates));
  });

  it('falls back safely on bad input', () => {
    expect(resolveLegalLocale('fr', ['pt-BR'])).toBe('pt-BR');
    expect(resolveLegalLocale(undefined, undefined)).toBe('en-GB');
    expect(resolveLegalLocale(42, null)).toBe('en-GB');
    expect(resolveLegalLocale(null, [42, 'es'])).toBe('es');
    expect(localeFromTag('')).toBeNull();
    expect(localeFromTag('constructor')).toBeNull();
  });
});

describe('applyLegalLocale', () => {
  beforeEach(fixture);

  it('shows one article and marks the active language', () => {
    applyLegalLocale(document, 'es');
    const visible = [...document.querySelectorAll('article[data-locale]')].filter((a) => !a.hidden);
    expect(visible.map((a) => a.dataset.locale)).toEqual(['es']);
    expect(document.documentElement.lang).toBe('es');
    expect(document.title).toBe('Política de privacidad');
    const current = [...document.querySelectorAll('[aria-current="page"]')].map((a) =>
      a.getAttribute('hreflang'),
    );
    expect(current).toEqual(['es']);

    applyLegalLocale(document, 'pt-BR');
    expect(document.querySelector('article[data-locale="pt-BR"]').hidden).toBe(false);
    expect(document.querySelector('article[data-locale="es"]').hidden).toBe(true);
    const moved = [...document.querySelectorAll('[aria-current="page"]')].map((a) =>
      a.getAttribute('hreflang'),
    );
    expect(moved).toEqual(['pt-BR']);
  });
});

describe('applySiteChrome', () => {
  beforeEach(fixture);

  it('switches the chrome text, href and aria-label with the article', () => {
    applyLegalLocale(document, 'es');
    expect(byId('skip').textContent).toBe('Saltar al contenido');
    expect(byId('faq').textContent).toBe('Preguntas');
    expect(byId('faq').getAttribute('href')).toBe('/es/faq');
    expect(byId('menu').getAttribute('aria-label')).toBe('Menú');
    expect(byId('privacy').getAttribute('href')).toBe('/privacy?lang=es');
    expect(byId('privacy').textContent).toBe('Privacidad');

    applyLegalLocale(document, 'pt-BR');
    expect(byId('faq').textContent).toBe('Dúvidas');
    expect(byId('faq').getAttribute('href')).toBe('/pt-br/faq');
    expect(byId('menu').getAttribute('aria-label')).toBe('Menu');
    expect(byId('privacy').getAttribute('href')).toBe('/privacy?lang=pt-BR');

    applyLegalLocale(document, 'en-GB');
    expect(byId('faq').textContent).toBe('FAQ');
    expect(byId('faq').getAttribute('href')).toBe('/faq');
    expect(byId('skip').textContent).toBe('Skip to content');
  });

  it('keeps an element without the locale variant unchanged', () => {
    expect(() => applySiteChrome(document, 'es')).not.toThrow();
    expect(byId('partial').textContent).toBe('Home');
    expect(byId('partial').getAttribute('href')).toBe('/');
    expect(byId('skip').getAttribute('href')).toBe('#main');
  });

  it('leaves the article, title and language links to applyLegalLocale', () => {
    applySiteChrome(document, 'es');
    expect(document.title).toBe('Original');
    expect(document.documentElement.lang).toBe('en-GB');
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0);
  });
});

describe('initLegalPage', () => {
  it('does nothing outside a legal page', () => {
    document.body.innerHTML = '<p>not legal</p>';
    document.documentElement.lang = 'en-GB';
    document.title = 'Other';
    initLegalPage({ document, location: { search: '?lang=es' }, navigator: { languages: [] } });
    expect(document.documentElement.lang).toBe('en-GB');
    expect(document.title).toBe('Other');
  });

  it('applies the resolved language on a legal page', () => {
    fixture();
    initLegalPage({
      document,
      location: { search: '?lang=pt-BR' },
      navigator: { languages: ['es'] },
    });
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(byId('faq').textContent).toBe('Dúvidas');
  });

  it('falls back from ?lang=xx to the first browser language, then en-GB', () => {
    fixture();
    initLegalPage({
      document,
      location: { search: '?lang=xx' },
      navigator: { languages: ['es-MX', 'en'] },
    });
    expect(visibleLocales()).toEqual(['es']);
    expect(document.documentElement.lang).toBe('es');
    expect(byId('faq').textContent).toBe('Preguntas');
    expect(byId('menu').getAttribute('aria-label')).toBe('Menú');

    fixture();
    initLegalPage({
      document,
      location: { search: '?lang=xx' },
      navigator: { languages: ['fr-FR'] },
    });
    expect(visibleLocales()).toEqual(['en-GB']);
    expect(document.documentElement.lang).toBe('en-GB');
    expect(byId('faq').textContent).toBe('FAQ');
    expect(byId('faq').getAttribute('href')).toBe('/faq');
  });
});

function notFoundFixture() {
  document.documentElement.lang = 'en-GB';
  document.title = 'Original';
  document.body.innerHTML = `
    <main data-legal-page="404">
      <article data-locale="en-GB" data-title="Page not found - Pocket Notes">en</article>
      <article data-locale="es" data-title="Página no encontrada - Pocket Notes">es</article>
      <article data-locale="pt-BR" data-title="Página não encontrada - Pocket Notes">pt</article>
    </main>`;
}

function visibleLocales() {
  return [...document.querySelectorAll('article[data-locale]')]
    .filter((a) => !a.hidden)
    .map((a) => a.dataset.locale);
}

describe('404 page', () => {
  it('resolves ?lang= on a data-legal-page="404" document', () => {
    notFoundFixture();
    initLegalPage({ document, location: { search: '?lang=es' }, navigator: { languages: [] } });
    expect(visibleLocales()).toEqual(['es']);
    expect(document.documentElement.lang).toBe('es');
    expect(document.title).toBe('Página no encontrada - Pocket Notes');
  });

  it('falls back to en-GB for an unsupported browser language', () => {
    notFoundFixture();
    initLegalPage({ document, location: { search: '' }, navigator: { languages: ['fr-FR'] } });
    expect(visibleLocales()).toEqual(['en-GB']);
  });

  it('public/404.html links home in every locale', () => {
    const html = NOT_FOUND_HTML;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('main[data-legal-page="404"]')).not.toBeNull();
    expect(doc.title).toBe(
      `${createSiteTranslator('en-GB').t('site.notFound.title')} - Pocket Notes`,
    );
    const articles = [...doc.querySelectorAll('article[data-locale]')];
    expect(articles.map((a) => a.getAttribute('data-locale'))).toEqual(['en-GB', 'es', 'pt-BR']);
    for (const article of articles) {
      const locale = article.getAttribute('data-locale');
      expect(article.id).toBe(locale);
      expect(article.lang).toBe(locale);
      const { t } = createSiteTranslator(locale);
      expect(article.getAttribute('data-title')).toBe(`${t('site.notFound.title')} - Pocket Notes`);
      expect(article.querySelectorAll('h1')).toHaveLength(1);
      expect(article.querySelector('h1').textContent).toBe(t('site.notFound.title'));
      expect(article.querySelectorAll('p')).toHaveLength(1);
      expect(article.querySelector('p').textContent).toBe(t('site.notFound.body'));
      const links = [...article.querySelectorAll('a')];
      const home = { 'en-GB': '/', es: '/es/', 'pt-BR': '/pt-br/' }[locale];
      expect(links.map((a) => a.getAttribute('href'))).toEqual([home]);
      expect(links.map((a) => a.textContent)).toEqual([t('site.notFound.home')]);
    }
    expect(doc.querySelector('link[rel="stylesheet"]').getAttribute('href')).toBe('/legal.css');
    const scripts = [...doc.querySelectorAll('script')];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('type')).toBe('module');
    expect(scripts[0].getAttribute('src')).toBe('/legal.js');
    expect(doc.getElementById('root')).toBeNull();
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });

  it('public/404.html switches the article, title and header with ?lang=pt-BR', () => {
    const doc = new DOMParser().parseFromString(NOT_FOUND_HTML, 'text/html');
    document.documentElement.lang = 'en-GB';
    document.head.innerHTML = doc.head.innerHTML;
    document.body.innerHTML = doc.body.innerHTML;
    initLegalPage({ document, location: { search: '?lang=pt-BR' }, navigator: { languages: [] } });
    expect(visibleLocales()).toEqual(['pt-BR']);
    expect(document.title).toBe('Página não encontrada - Pocket Notes');
    const faq = document.querySelector('header [data-site-key="site.nav.faq"]');
    expect(faq.getAttribute('href')).toBe('/pt-br/faq');
    expect(faq.textContent).toBe('Dúvidas');
  });
});
