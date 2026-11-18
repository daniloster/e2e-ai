// Store href rewrite at interaction time + store_click. Never throws from a listener.
import type { Locale } from '@pn/i18n';

import {
  APP_STORE_PROVIDER_TOKEN,
  STORE_LINKS,
  type SitePageAnalyticsId,
  type StoreLinks,
} from '../config';
import { campaignFrom, storeUrl, type StoreId } from './campaign';
import { siteTrack, type SiteAnalyticsEvent } from './siteAnalytics';

export interface StoreLinkDeps {
  page: SitePageAnalyticsId;
  locale: Locale;
  links?: StoreLinks;
  providerToken?: string | null;
  search?: () => string;
  track?: (e: SiteAnalyticsEvent) => void;
}

type StorePlacement = 'hero' | 'footer' | 'page';

function isStoreId(value: string | undefined): value is StoreId {
  return value === 'app_store' || value === 'google_play';
}

function isStorePlacement(value: string | undefined): value is StorePlacement {
  return value === 'hero' || value === 'footer' || value === 'page';
}

function safely(track: (e: SiteAnalyticsEvent) => void, event: SiteAnalyticsEvent): void {
  try {
    track(event);
  } catch {
    // Analytics must never break a link.
  }
}

/** Both links null -> 0, nothing attached. Rewrites on pointerdown / Enter / click; tracks on click. */
export function bindStoreLinks(doc: Document, deps: StoreLinkDeps): number {
  const links = deps.links ?? STORE_LINKS;
  if (links.appStore === null && links.googlePlay === null) return 0;
  const providerToken =
    deps.providerToken === undefined ? APP_STORE_PROVIDER_TOKEN : deps.providerToken;
  const search = deps.search ?? (() => doc.defaultView?.location.search ?? '');
  const track = deps.track ?? siteTrack;
  let bound = 0;
  for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[data-store]')) {
    const store = anchor.dataset.store;
    if (!isStoreId(store)) continue;
    if ((store === 'app_store' ? links.appStore : links.googlePlay) === null) continue;
    const rewrite = (): void => {
      try {
        const url = storeUrl(store, links, providerToken, campaignFrom(search(), deps.page));
        if (url !== null) anchor.href = url;
      } catch {
        // A bad base URL keeps the href as rendered.
      }
    };
    anchor.addEventListener('pointerdown', rewrite);
    anchor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') rewrite();
    });
    anchor.addEventListener('click', () => {
      rewrite();
      const placement = anchor.dataset.placement;
      if (!isStorePlacement(placement)) return;
      safely(track, {
        name: 'store_click',
        params: { store, placement, page: deps.page, locale: deps.locale },
      });
    });
    bound += 1;
  }
  return bound;
}
