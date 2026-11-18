// utm_* sanitising and the App Store / Google Play campaign URLs. Pure: every input passed in.
import type { SitePageAnalyticsId, StoreLinks } from '../config';

export interface Campaign {
  source: string;
  medium: string;
  campaign: string;
}

export type StoreId = 'app_store' | 'google_play';

export const CAMPAIGN_VALUE = /^[A-Za-z0-9_-]{1,40}$/;

function pick(params: URLSearchParams, name: string, fallback: string): string {
  const value = params.get(name);
  return value !== null && CAMPAIGN_VALUE.test(value) ? value : fallback;
}

/** Defaults site / organic / <page>, per field, for an absent, empty, too long or otherwise invalid value. */
export function campaignFrom(search: string, page: SitePageAnalyticsId): Campaign {
  const params = new URLSearchParams(search);
  return Object.freeze<Campaign>({
    source: pick(params, 'utm_source', 'site'),
    medium: pick(params, 'utm_medium', 'organic'),
    campaign: pick(params, 'utm_campaign', page),
  });
}

/** base + pt (only with a token) + ct; every other base parameter is kept. Throws TypeError on a relative base. */
export function appStoreUrl(base: string, providerToken: string | null, c: Campaign): string {
  const url = new URL(base);
  if (providerToken !== null) url.searchParams.set('pt', providerToken);
  url.searchParams.set('ct', c.campaign);
  return url.toString();
}

/** base + exactly one referrer, encoded once by URLSearchParams. Throws TypeError on a relative base. */
export function playStoreUrl(base: string, c: Campaign): string {
  const url = new URL(base);
  url.searchParams.set(
    'referrer',
    `utm_source=${c.source}&utm_medium=${c.medium}&utm_campaign=${c.campaign}`,
  );
  return url.toString();
}

/** The campaign URL of one store, or null while its listing link is null. */
export function storeUrl(
  store: StoreId,
  links: StoreLinks,
  providerToken: string | null,
  c: Campaign,
): string | null {
  if (store === 'app_store') {
    return links.appStore === null ? null : appStoreUrl(links.appStore, providerToken, c);
  }
  return links.googlePlay === null ? null : playStoreUrl(links.googlePlay, c);
}
