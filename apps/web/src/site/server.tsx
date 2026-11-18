// SSR entry of the site, loaded by the sitePages() Vite plugin with ssrLoadModule.
// Node only: no DOM globals. renderSite is the Strategy consumer: it never branches on the page id.
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@pn/i18n';
import { createSiteTranslator } from '@pn/i18n/site';

import {
  SITE_LOCALES,
  SITE_ORIGIN,
  SITE_PAGE_ANALYTICS_IDS,
  pageOutPath,
  type SitePageAnalyticsId,
} from './config';
import { Head } from './Head';
import { SITE_PAGES, createRenderContext, type SitePageDef } from './pages';

export { siteTokensCss } from './theme';

export interface RenderedPage {
  outPath: string;
  /** Source template file name, e.g. 'index.html'. */
  template: string;
  head: string;
  body: string;
  lang: Locale;
  /** The analytics page id, written to <html data-site-page> for the client boot. */
  sitePage: SitePageAnalyticsId;
}

// Every page x locale, page-major in registry order.
export function renderSite(pages: readonly SitePageDef[] = SITE_PAGES): readonly RenderedPage[] {
  const rendered: RenderedPage[] = [];
  for (const page of pages) {
    for (const locale of SITE_LOCALES) {
      const t = createSiteTranslator(locale);
      const ctx = createRenderContext(locale, pages);
      rendered.push({
        outPath: pageOutPath(page.slug, locale),
        template: page.template,
        head: renderToStaticMarkup(<Head t={t} ctx={ctx} page={page} />),
        body: renderToStaticMarkup(page.render(t, ctx)),
        lang: locale,
        sitePage: SITE_PAGE_ANALYTICS_IDS[page.id],
      });
    }
  }
  return rendered;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sitemapXml(pages: readonly SitePageDef[] = SITE_PAGES): string {
  const urls: string[] = [];
  for (const page of pages) {
    if (page.noindex === true) continue;
    for (const locale of SITE_LOCALES) {
      const ctx = createRenderContext(locale, pages);
      const alternates = [...SITE_LOCALES, 'x-default' as const].map((hreflang) => {
        const href = ctx.absoluteUrl(page.id, hreflang === 'x-default' ? 'en-GB' : hreflang);
        return `    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}"/>`;
      });
      urls.push(
        [
          '  <url>',
          `    <loc>${escapeXml(ctx.absoluteUrl(page.id))}</loc>`,
          ...alternates,
          '  </url>',
        ].join('\n'),
      );
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}
