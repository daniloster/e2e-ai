// Site origin, locales, store links and the URL / out-path mapping. Pure: loaded by the Vite config too.
import type { Locale } from '@pn/i18n';

// The production origin (wrangler.json routes, the AASA / assetlinks hosts and the app's link domain).
export const SITE_ORIGIN = 'https://pocketnotes.app';

/** The custom URL scheme of the app; a shared link opens as `pocketnotes://s#<payload>`. */
export const APP_SCHEME = 'pocketnotes';
/** The app's bundle id (iOS) and package name (Android). */
export const APP_ID = 'com.pocketnotes';

/** The one contact address: /contact, /support, /your-data and the legal pages. */
export const CONTACT_EMAIL = 'support@pocketnotes.app';

export type SitePageId = 'home' | 'faq' | 'contact' | 'support' | 'yourData' | 'get' | 'share';
// Snake-case page ids carried by the site analytics events.
export type SitePageAnalyticsId =
  'home' | 'faq' | 'contact' | 'support' | 'your_data' | 'get' | 'share';
export type PathLocale = '' | 'es' | 'pt-br';

export interface StoreLinks {
  appStore: string | null;
  googlePlay: string | null;
}

/**
 * The app's numeric Apple ID (App Store Connect > App Information). REPLACE the zeros once the app
 * record exists; nothing links to it while LISTINGS_LIVE.appStore is false.
 */
export const APPLE_APP_ID = '0000000000';
export const APP_STORE_LISTING = `https://apps.apple.com/app/id${APPLE_APP_ID}`;
export const GOOGLE_PLAY_LISTING = `https://play.google.com/store/apps/details?id=${APP_ID}`;

// Whether the site links each store. false shows a "coming soon" badge with no link. Flip each one
// in launch week, once its listing exists (it may still be in review).
export const LISTINGS_LIVE: Readonly<Record<keyof StoreLinks, boolean>> = Object.freeze({
  appStore: false,
  googlePlay: false,
});

// Store listing URLs. null renders the "coming soon" badge with no link.
export const STORE_LINKS: StoreLinks = Object.freeze<StoreLinks>({
  appStore: LISTINGS_LIVE.appStore ? APP_STORE_LISTING : null,
  googlePlay: LISTINGS_LIVE.googlePlay ? GOOGLE_PLAY_LISTING : null,
});

// From App Store Connect. The provider token (pt) stays null until App Analytics campaign links are
// set up; the id feeds Safari's Smart App Banner, so it is null until the App Store listing is live.
export const APP_STORE_PROVIDER_TOKEN: string | null = null;
export const APP_STORE_ID: string | null = LISTINGS_LIVE.appStore ? APPLE_APP_ID : null;

export const SITE_PAGE_ANALYTICS_IDS: Readonly<Record<SitePageId, SitePageAnalyticsId>> =
  Object.freeze<Record<SitePageId, SitePageAnalyticsId>>({
    home: 'home',
    faq: 'faq',
    contact: 'contact',
    support: 'support',
    yourData: 'your_data',
    get: 'get',
    share: 'share',
  });

const ANALYTICS_IDS: ReadonlySet<string> = new Set(Object.values(SITE_PAGE_ANALYTICS_IDS));

export function isSitePageAnalyticsId(value: unknown): value is SitePageAnalyticsId {
  return typeof value === 'string' && ANALYTICS_IDS.has(value);
}

export const SITE_LOCALES: readonly Locale[] = Object.freeze<Locale[]>(['en-GB', 'es', 'pt-BR']);

const PATH_LOCALES: Readonly<Record<Locale, PathLocale>> = Object.freeze({
  'en-GB': '',
  es: 'es',
  'pt-BR': 'pt-br',
});

export function pathLocaleOf(locale: Locale): PathLocale {
  return PATH_LOCALES[locale];
}

// First segment, case-insensitive; anything else is 'en-GB' (served without a prefix).
export function localeOfPath(pathname: string): Locale {
  const first = (pathname.split('/')[1] ?? '').toLowerCase();
  if (first === '') return 'en-GB';
  for (const locale of SITE_LOCALES) {
    if (PATH_LOCALES[locale] === first) return locale;
  }
  return 'en-GB';
}

// '' slug = home. '/', '/es/', '/pt-br/', '/faq', '/es/faq'.
export function pagePath(slug: string, locale: Locale): string {
  const prefix = pathLocaleOf(locale);
  const base = prefix === '' ? '/' : `/${prefix}/`;
  return `${base}${slug}`;
}

// 'index.html', 'es/index.html', 'faq.html', 'pt-br/faq.html'.
export function pageOutPath(slug: string, locale: Locale): string {
  const prefix = pathLocaleOf(locale);
  const file = `${slug === '' ? 'index' : slug}.html`;
  return prefix === '' ? file : `${prefix}/${file}`;
}
