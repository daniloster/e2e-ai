// @vitest-environment node
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UI_COLORS } from '@pn/design-tokens';
import { SITE_CATALOGS, createSiteTranslator } from '@pn/i18n/site';
import { describe, expect, it } from 'vitest';

import { Head } from './Head';
import { SITE_PAGES, createRenderContext, type SitePageDef } from './pages';
import { renderSite, robotsTxt, sitemapXml } from './server';

// jsdom ships no types; only its DOMParser is needed for the well-formedness check.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } };
};

const home = SITE_PAGES[0] as SitePageDef;
const getPage = SITE_PAGES.find((p) => p.id === 'get') as SitePageDef;

function headMarkup(page: SitePageDef, appStoreId?: string | null): string {
  const t = createSiteTranslator('en-GB');
  const ctx = createRenderContext('en-GB');
  return renderToStaticMarkup(
    appStoreId === undefined ? (
      <Head t={t} ctx={ctx} page={page} />
    ) : (
      <Head t={t} ctx={ctx} page={page} appStoreId={appStoreId} />
    ),
  );
}

describe('renderSite', () => {
  const pages = renderSite();

  it('renders every page in every locale, page-major', () => {
    expect(pages).toHaveLength(SITE_PAGES.length * 3);
    expect(pages.slice(0, 3).map((p) => [p.outPath, p.lang, p.template])).toEqual([
      ['index.html', 'en-GB', 'index.html'],
      ['es/index.html', 'es', 'index.html'],
      ['pt-br/index.html', 'pt-BR', 'index.html'],
    ]);
    expect(pages.map((p) => p.outPath)).toContain('pt-br/your-data.html');
    expect(pages.map((p) => p.outPath)).toContain('s.html');
    expect(new Set(pages.map((p) => p.outPath)).size).toBe(pages.length);
  });

  it('writes the analytics page id of each page', () => {
    expect(pages.find((p) => p.outPath === 'es/faq.html')?.sitePage).toBe('faq');
    expect(pages.find((p) => p.outPath === 'your-data.html')?.sitePage).toBe('your_data');
    expect(pages.find((p) => p.outPath === 's.html')?.sitePage).toBe('share');
  });

  it('renders the locale copy inside the layout', () => {
    const esHome = pages.find((p) => p.outPath === 'es/index.html');
    expect(esHome?.body).toContain(SITE_CATALOGS.es['site.home.heading']);
    expect(esHome?.body).toContain(SITE_CATALOGS.es['site.nav.faq']);
    expect(esHome?.body).toContain('<main');
  });

  it('produces well-formed markup with no stray /play route', () => {
    const parser = new new JSDOM('').window.DOMParser();
    for (const page of pages) {
      const doc = parser.parseFromString(`<body>${page.body}</body>`, 'text/html');
      expect(doc.querySelector('main'), page.outPath).not.toBeNull();
      // A /play route, not the Google Play listing (play.google.com).
      expect(page.body).not.toMatch(/(?<!\/)\/play\b/i);
      expect(page.head).not.toMatch(/(?<!\/)\/play\b/i);
    }
  });

  it('shows the contact address as text and as a mailto link', () => {
    const contact = pages.find((p) => p.outPath === 'contact.html')!;
    expect(contact.body).toMatch(
      /<a [^>]*href="mailto:[^"]+@pocketnotes\.app"[^>]*>[^<]+@pocketnotes\.app<\/a>/,
    );
  });

  it('renders the /s fallback with the scheme link hidden until the client sets it', () => {
    const share = pages.find((p) => p.outPath === 's.html')!;
    expect(share.body).toContain('href="pocketnotes://s"');
    expect(share.body).toMatch(/<p data-share-open="true" hidden=""/);
    expect(share.body).toMatch(/<p data-share-invalid="true" hidden=""/);
  });
});

describe('Head', () => {
  it('carries title, canonical, hreflang alternates and x-default en-GB', () => {
    const html = headMarkup(home);
    expect(html).toContain(`<title>${SITE_CATALOGS['en-GB']['site.meta.defaultTitle']}</title>`);
    expect(html).toContain('<link rel="canonical" href="https://pocketnotes.app/"/>');
    expect(html).toContain('hrefLang="en-GB" href="https://pocketnotes.app/"');
    expect(html).toContain('hrefLang="es" href="https://pocketnotes.app/es/"');
    expect(html).toContain('hrefLang="x-default" href="https://pocketnotes.app/"');
    expect(html).toContain('<meta property="og:locale" content="en_GB"/>');
    expect(html).toContain(`<meta name="theme-color" content="${UI_COLORS.bg}"/>`);
    expect(html).toContain('"@type":"WebSite"');
  });

  it('adds robots noindex only on a noindex page', () => {
    expect(headMarkup(home)).not.toContain('noindex');
    expect(headMarkup(getPage)).toContain('<meta name="robots" content="noindex"/>');
  });

  it('adds the Smart App Banner only with an App Store id', () => {
    expect(headMarkup(home, null)).not.toContain('apple-itunes-app');
    // No id until LISTINGS_LIVE.appStore is flipped.
    expect(headMarkup(home)).not.toContain('apple-itunes-app');
    expect(headMarkup(home, '123')).toContain(
      '<meta name="apple-itunes-app" content="app-id=123"/>',
    );
  });

  it('escapes < in JSON-LD', () => {
    const page: SitePageDef = { ...home, jsonLd: () => [{ text: '</script>' }] };
    expect(headMarkup(page)).toContain('\\u003c/script>');
  });
});

describe('sitemapXml and robotsTxt', () => {
  it('lists the indexable pages with alternates, never /get or /s', () => {
    const xml = sitemapXml();
    expect(xml).toContain('<loc>https://pocketnotes.app/</loc>');
    expect(xml).toContain('<loc>https://pocketnotes.app/pt-br/support</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://pocketnotes.app/faq"');
    expect(xml).not.toContain('/get<');
    expect(xml).not.toContain('/s<');
    expect(xml.match(/<url>/g)).toHaveLength((SITE_PAGES.length - 2) * 3);
  });

  it('allows everything and points at the sitemap', () => {
    expect(robotsTxt()).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://pocketnotes.app/sitemap.xml\n',
    );
  });

  it('renders the head of a fixture page too', () => {
    const fixture: SitePageDef = { ...home, render: () => createElement('main') };
    expect(headMarkup(fixture)).toContain('<title>');
  });
});
