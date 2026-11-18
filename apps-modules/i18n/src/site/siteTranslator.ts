// Site catalogs, SiteKey and the site translator factory, reusing createTranslatorWith (createTranslatorWith).
import type { Catalog, Locale, MessageKey, Params, PluralSuffix } from '../types';
import { createTranslatorWith, defaultWarn } from '../translator';
import { siteEnGB } from './en-GB';
import { siteEs } from './es';
import { sitePtBR } from './pt-BR';

type StripPlural<K> = K extends `${infer Base}${PluralSuffix}` ? Base : K;
/** Every site catalog key with plural suffixes removed. Closed: 'site.nope' is a type error. */
export type SiteKey = StripPlural<keyof typeof siteEnGB>;

export interface SiteTranslator {
  locale: Locale;
  t(key: SiteKey, params?: Params): string;
}

export const SITE_CATALOGS: Readonly<Record<Locale, Catalog>> = {
  'en-GB': siteEnGB,
  es: siteEs,
  'pt-BR': sitePtBR,
};

// Test seam; same contract as createTranslatorWith. Not exported from @pn/i18n/site.
export function createSiteTranslatorWith(
  locale: Locale,
  catalogs: Readonly<Record<Locale, Catalog>>,
  warn: (message: string) => void,
): SiteTranslator {
  const shared = createTranslatorWith(locale, catalogs, warn);

  function t(key: SiteKey, params?: Params): string {
    // The shared translator only uses the key as a lookup string at runtime.
    return shared.t(key as string as MessageKey, params);
  }

  return { locale, t };
}

export function createSiteTranslator(locale: Locale): SiteTranslator {
  return createSiteTranslatorWith(locale, SITE_CATALOGS, defaultWarn);
}
