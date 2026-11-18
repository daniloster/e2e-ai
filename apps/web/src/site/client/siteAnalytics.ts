// Consent-gated lazy Proxy over the analytics facade:
// siteTrack stands in for track; the facade is a separate chunk reached only through import() after consent.
import type { Locale } from '@pn/i18n';

import type { SitePageAnalyticsId } from '../config';

type WebAnalyticsEvent = import('../../analytics').WebAnalyticsEvent;
export type SiteAnalyticsEvent = import('../../analytics').SiteAnalyticsEvent;

export interface AnalyticsModules {
  initFirebase(): Promise<void>;
  track(e: WebAnalyticsEvent): void;
}

export interface SiteAnalyticsDeps {
  page: SitePageAnalyticsId;
  locale: Locale;
  /** The visitor just chose "Allow analytics": also send consent_choice. */
  choice?: true;
  load?: () => Promise<AnalyticsModules>;
}

// One page view's state; a page load is a new module instance.
let loading: Promise<AnalyticsModules | null> | null = null;
let forward: ((e: WebAnalyticsEvent) => void) | null = null;
let stopped = false;
let pageViewSent = false;

/** Loads the Firebase facade and the analytics facade in parallel. */
export async function loadAnalyticsModules(): Promise<AnalyticsModules> {
  const [firebase, analytics] = await Promise.all([
    import('../../firebase'),
    import('../../analytics'),
  ]);
  return { initFirebase: firebase.initFirebase, track: analytics.track };
}

async function loadOnce(load: () => Promise<AnalyticsModules>): Promise<AnalyticsModules | null> {
  try {
    const modules = await load();
    await modules.initFirebase();
    return modules;
  } catch {
    // Offline or blocked: analytics stays off for this page view, with no retry.
    return null;
  }
}

function send(event: SiteAnalyticsEvent): void {
  if (stopped || forward === null) return;
  try {
    forward(event);
  } catch {
    // Analytics must never break the page.
  }
}

/** Idempotent, never rejects. Loads once, initFirebase once, then site_page_view once (+ consent_choice on a choice). */
export async function startSiteAnalytics(deps: SiteAnalyticsDeps): Promise<void> {
  stopped = false;
  loading ??= loadOnce(deps.load ?? loadAnalyticsModules);
  const modules = await loading;
  if (stopped || modules === null) return;
  forward = modules.track;
  if (!pageViewSent) {
    pageViewSent = true;
    send({ name: 'site_page_view', params: { page: deps.page, locale: deps.locale } });
  }
  if (deps.choice === true) send({ name: 'consent_choice', params: { analytics: true } });
}

/** A refusal in this page view: every later siteTrack is a no-op (the SDK cannot be unloaded). */
export function stopSiteAnalytics(): void {
  stopped = true;
}

/** Synchronous, never throws. Forwards only while started and not stopped; otherwise dropped (no queue). */
export function siteTrack(event: SiteAnalyticsEvent): void {
  send(event);
}
