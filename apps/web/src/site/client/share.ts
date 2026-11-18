// /s#<payload>: hand a shared link to the app. The payload lives in the fragment, so it
// never reaches the host. With the app installed, Universal Links / App Links open it before this
// page loads; here the page tries the custom scheme, then reveals the store fallback (and, on a
// phone whose store listing is live, redirects to it). No analytics event: it would race the
// navigation. Never throws.
import { APP_SCHEME, APP_STORE_PROVIDER_TOKEN, STORE_LINKS, type StoreLinks } from '../config';
import { campaignFrom, storeUrl } from './campaign';
import { storeForUserAgent } from './get';

/** A share payload is base64url (the @pn/core share codec): at most a few KB, no padding. */
export const SHARE_PAYLOAD = /^[A-Za-z0-9_-]{1,4096}$/;

/** How long the page waits for the app to take over before it offers the store. */
export const APP_OPEN_TIMEOUT_MS = 1500;

/** '#abc' -> 'abc'; null for an empty or invalid fragment. */
export function sharePayloadOf(hash: string): string | null {
  const payload = hash.startsWith('#') ? hash.slice(1) : hash;
  return SHARE_PAYLOAD.test(payload) ? payload : null;
}

/** The custom-scheme URL of a shared link: pocketnotes://s#<payload>. */
export function appShareUrl(payload: string): string {
  return `${APP_SCHEME}://s#${payload}`;
}

export type ShareOutcome = 'invalid' | 'opening';

export interface ShareLandingDeps {
  links?: StoreLinks;
  providerToken?: string | null;
  timeoutMs?: number;
  setTimer?: (run: () => void, ms: number) => void;
}

function reveal(doc: Document, selector: string, shown: boolean): void {
  const el = doc.querySelector<HTMLElement>(selector);
  if (el) el.hidden = !shown;
}

export function mountShareLanding(win: Window, deps: ShareLandingDeps = {}): ShareOutcome {
  const doc = win.document;
  try {
    const payload = sharePayloadOf(win.location.hash);
    if (payload === null) {
      reveal(doc, '[data-share-invalid]', true);
      return 'invalid';
    }
    const url = appShareUrl(payload);
    const link = doc.querySelector<HTMLAnchorElement>('[data-share-app-link]');
    if (link) link.href = url;
    reveal(doc, '[data-share-open]', true);
    reveal(doc, '[data-share-opening]', true);
    const setTimer = deps.setTimer ?? ((run, ms) => win.setTimeout(run, ms));
    setTimer(() => {
      reveal(doc, '[data-share-opening]', false);
      // The app took over: the page is in the background, so stay put.
      if (doc.visibilityState === 'hidden') return;
      const store = storeForUserAgent(win.navigator.userAgent);
      if (store === null) return;
      const providerToken =
        deps.providerToken === undefined ? APP_STORE_PROVIDER_TOKEN : deps.providerToken;
      const target = storeUrl(
        store,
        deps.links ?? STORE_LINKS,
        providerToken,
        campaignFrom(win.location.search, 'share'),
      );
      if (target !== null) win.location.assign(target);
    }, deps.timeoutMs ?? APP_OPEN_TIMEOUT_MS);
    win.location.assign(url);
    return 'opening';
  } catch {
    reveal(doc, '[data-share-invalid]', true);
    return 'invalid';
  }
}
