// Public entry of @pn/i18n/site. Site copy only: imported by the prerender, never by the app.
import type { SiteKey } from './siteTranslator';

export type { SiteKey, SiteTranslator } from './siteTranslator';
export { SITE_CATALOGS, createSiteTranslator } from './siteTranslator';

/**
 * Tappable site buttons held to the ≤ 24 / no-article rule. Official store badge wording (fixed
 * by Apple and Google) is excluded. Add every new tappable site button key here.
 */
export const SITE_BUTTON_KEYS: readonly SiteKey[] = [
  'site.cta.getApp',
  'site.consent.accept',
  'site.consent.decline',
  'site.consent.settings',
  'site.lang.switch',
  'site.lang.dismiss',
  'site.share.open',
  'site.notFound.home',
];
