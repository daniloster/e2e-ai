// The site page registry (Strategy): each entry renders its
// own body and JSON-LD; renderSite only iterates and never branches on the page id.
import { createElement, type JSX } from 'react';
import type { Locale } from '@pn/i18n';
import type { SiteKey, SiteTranslator } from '@pn/i18n/site';

import { SITE_ORIGIN, pagePath, pathLocaleOf, type PathLocale, type SitePageId } from './config';
import { Layout } from './layout/Layout';
import { Contact } from './pages/Contact';
import { Faq, faqJsonLd } from './pages/Faq';
import { GetPage } from './pages/Get';
import { Home, homeJsonLd } from './pages/Home';
import { ShareLanding } from './pages/ShareLanding';
import { Support } from './pages/Support';
import { YourData } from './pages/YourData';

export interface SitePageDef {
  id: SitePageId;
  template: string; // the HTML template file, e.g. 'index.html', 'faq.html'
  slug: string; // '' for home, else the URL segment
  titleKey: SiteKey;
  descriptionKey: SiteKey;
  render(t: SiteTranslator, ctx: RenderContext): JSX.Element;
  jsonLd?(t: SiteTranslator, ctx: RenderContext): readonly object[];
  noindex?: true; // robots noindex meta, left out of sitemap.xml
}

export interface RenderContext {
  locale: Locale;
  pathLocale: PathLocale;
  url(page: SitePageId, locale?: Locale): string; // root-relative, e.g. '/es/faq'
  absoluteUrl(page: SitePageId, locale?: Locale): string;
  has(page: SitePageId): boolean; // true when the registry has this page (links to unbuilt pages are omitted)
}

// url/absoluteUrl look the id up in `pages`; an id with no entry throws, so no link points at an unbuilt page.
export function createRenderContext(
  locale: Locale,
  pages: readonly SitePageDef[] = SITE_PAGES,
): RenderContext {
  function url(id: SitePageId, target: Locale = locale): string {
    const page = pages.find((p) => p.id === id);
    if (page === undefined) throw new Error(`site: no page with id "${id}" in the registry`);
    return pagePath(page.slug, target);
  }
  return {
    locale,
    pathLocale: pathLocaleOf(locale),
    url,
    absoluteUrl(id, target = locale) {
      return SITE_ORIGIN + url(id, target);
    },
    has(id) {
      return pages.some((p) => p.id === id);
    },
  };
}

type Body = (props: { t: SiteTranslator; ctx: RenderContext }) => JSX.Element;

// A page whose body sits inside the shared Layout.
function laidOut(def: Omit<SitePageDef, 'render'>, body: Body): SitePageDef {
  return Object.freeze<SitePageDef>({
    ...def,
    render(t, ctx) {
      return createElement(Layout, {
        t,
        ctx,
        current: def.id,
        children: createElement(body, { t, ctx }),
      });
    },
  });
}

export const SITE_PAGES: readonly SitePageDef[] = Object.freeze([
  laidOut(
    {
      id: 'home',
      template: 'index.html',
      slug: '',
      titleKey: 'site.meta.defaultTitle',
      descriptionKey: 'site.meta.defaultDescription',
      jsonLd: homeJsonLd,
    },
    Home,
  ),
  laidOut(
    {
      id: 'faq',
      template: 'faq.html',
      slug: 'faq',
      titleKey: 'site.faq.metaTitle',
      descriptionKey: 'site.faq.metaDescription',
      jsonLd: faqJsonLd,
    },
    Faq,
  ),
  laidOut(
    {
      id: 'contact',
      template: 'contact.html',
      slug: 'contact',
      titleKey: 'site.contact.metaTitle',
      descriptionKey: 'site.contact.metaDescription',
    },
    Contact,
  ),
  // The App Store "Support URL": requirements, common problems and the contact address.
  laidOut(
    {
      id: 'support',
      template: 'support.html',
      slug: 'support',
      titleKey: 'site.support.metaTitle',
      descriptionKey: 'site.support.metaDescription',
    },
    Support,
  ),
  // What is kept where and how to remove it (Google Play's data deletion link).
  laidOut(
    {
      id: 'yourData',
      template: 'your-data.html',
      slug: 'your-data',
      titleKey: 'site.yourData.metaTitle',
      descriptionKey: 'site.yourData.metaDescription',
    },
    YourData,
  ),
  // /get sends a phone to its store; noindex, so it is left out of sitemap.xml.
  laidOut(
    {
      id: 'get',
      template: 'get.html',
      slug: 'get',
      titleKey: 'site.get.metaTitle',
      descriptionKey: 'site.get.metaDescription',
      noindex: true,
    },
    GetPage,
  ),
  // /s#<payload>: opens a shared link in the app, else falls back to the stores.
  laidOut(
    {
      id: 'share',
      template: 's.html',
      slug: 's',
      titleKey: 'site.share.metaTitle',
      descriptionKey: 'site.share.metaDescription',
      noindex: true,
    },
    ShareLanding,
  ),
]);
