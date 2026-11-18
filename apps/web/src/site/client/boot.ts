// Every site page's client composition root: <html data-site-page lang> ->
// readConsent -> mountConsentBanner; granted -> startSiteAnalytics. Then the store bindings and the
// language suggestion, each isolated so one failure never stops the others.
// Never throws.
import type { Locale } from '@pn/i18n';

import {
  APP_STORE_PROVIDER_TOKEN,
  SITE_LOCALES,
  STORE_LINKS,
  isSitePageAnalyticsId,
  type SitePageAnalyticsId,
  type StoreLinks,
} from '../config';
import { mountConsentBanner } from './banner';
import { consentState, readConsent } from './consent';
import { bindStoreLinks } from './links';
import { mountLocaleSuggestion } from './localeSuggest';
import { startSiteAnalytics, stopSiteAnalytics, type AnalyticsModules } from './siteAnalytics';

export interface BootDeps {
  load?: () => Promise<AnalyticsModules>;
  now?: () => number;
  links?: StoreLinks;
  providerToken?: string | null;
}

// navigator.languages when non-empty, else [navigator.language], else [] (some webviews have neither).
function languagesOf(nav: Navigator | undefined): readonly string[] {
  const languages: unknown = nav?.languages;
  if (Array.isArray(languages) && languages.length > 0) {
    return languages.filter((l): l is string => typeof l === 'string');
  }
  const language: unknown = nav?.language;
  return typeof language === 'string' ? [language] : [];
}

function isolated(work: () => void): void {
  try {
    work();
  } catch {
    // One binding failing must not stop the others.
  }
}

function storageOf(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    // Blocked storage (private mode, site data disabled): the choice is not remembered.
    return null;
  }
}

export function bootSite(win: Window, deps: BootDeps = {}): void {
  try {
    const now = deps.now ?? (() => Date.now());
    const storage = storageOf(win);
    const root = win.document.documentElement;
    const pageAttr: unknown = root.dataset.sitePage;
    const page: SitePageAnalyticsId | null = isSitePageAnalyticsId(pageAttr) ? pageAttr : null;
    const locale: Locale = SITE_LOCALES.find((l) => l === root.lang) ?? 'en-GB';
    const nowMs = now();
    const state = consentState(readConsent(storage, nowMs), nowMs);

    function start(choice: boolean): void {
      // A page without a known id never loads analytics; the banner still records the choice.
      if (page === null) return;
      void startSiteAnalytics({
        page,
        locale,
        ...(choice ? { choice: true as const } : {}),
        ...(deps.load ? { load: deps.load } : {}),
      });
    }

    mountConsentBanner(win.document, {
      state,
      storage,
      now,
      onGrant: () => start(true),
      onRefuse: stopSiteAnalytics,
    });
    if (state === 'granted') start(false);

    if (page !== null) {
      const doc = win.document;
      isolated(() => {
        bindStoreLinks(doc, {
          page,
          locale,
          links: deps.links ?? STORE_LINKS,
          providerToken:
            deps.providerToken === undefined ? APP_STORE_PROVIDER_TOKEN : deps.providerToken,
        });
      });
    }
    isolated(() => {
      mountLocaleSuggestion(win.document, {
        pageLocale: locale,
        languages: languagesOf(win.navigator),
        storage,
      });
    });
  } catch {
    // The page is static HTML: it works without the boot.
  }
}
