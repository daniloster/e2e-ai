// The closed set of website analytics events (no PII, no translated text) and the no-op-safe track().
import type { Locale } from '@pn/i18n';

import { getAnalyticsHandle } from './firebase';
import type { SitePageAnalyticsId } from './site/config';

export type WebAnalyticsEvent =
  | { name: 'site_page_view'; params: { page: SitePageAnalyticsId; locale: Locale } }
  | {
      name: 'store_click';
      params: {
        store: 'app_store' | 'google_play';
        placement: 'hero' | 'footer' | 'page';
        page: SitePageAnalyticsId;
        locale: Locale;
      };
    }
  // Sent only when granted.
  | { name: 'consent_choice'; params: { analytics: boolean } };

/** The product site's events: the only ones siteTrack forwards (today, every web event). */
export type SiteAnalyticsEvent = WebAnalyticsEvent;

/** Synchronous and never throws. A no-op until Analytics is ready. */
export function track(e: WebAnalyticsEvent): void {
  if (import.meta.env.DEV) console.debug('[analytics]', e.name, e.params);
  const handle = getAnalyticsHandle();
  if (!handle) return;
  try {
    // Widening to string selects logEvent's catch-all overload; the union matches none.
    handle.logEvent(handle.analytics, e.name as string, e.params);
  } catch {
    // Analytics must never break the page.
  }
}
