// /get: pick the store by user agent and redirect when its link is set. No top-level
// side effect (getEntry.ts calls it), no analytics event (it would race the navigation). Never throws.
import { APP_STORE_PROVIDER_TOKEN, STORE_LINKS, type StoreLinks } from '../config';
import { campaignFrom, storeUrl, type StoreId } from './campaign';

const APPLE = /\b(iPhone|iPad|iPod)\b/;
const ANDROID = /\bAndroid\b/i;
// Android TV / Google TV / Fire TV report Android too; a TV never goes to Play.
const TV_MARKERS =
  /\b(TV|GoogleTV|Google TV|Android TV|AndroidTV|Chromecast|CrKey|BRAVIA|SMART-TV|SmartTV|AFT[A-Z0-9]*)\b/i;

/** iPhone|iPad|iPod -> app_store; Android without TV markers -> google_play; else null. */
export function storeForUserAgent(ua: string): StoreId | null {
  if (APPLE.test(ua)) return 'app_store';
  if (ANDROID.test(ua) && !TV_MARKERS.test(ua)) return 'google_play';
  return null;
}

export type GetOutcome = 'redirected' | 'badges';

/** Never throws. Null link or no store -> 'badges' (no navigation). */
export function mountGetPage(
  win: Window,
  deps: { links?: StoreLinks; providerToken?: string | null } = {},
): GetOutcome {
  try {
    const links = deps.links ?? STORE_LINKS;
    const providerToken =
      deps.providerToken === undefined ? APP_STORE_PROVIDER_TOKEN : deps.providerToken;
    const store = storeForUserAgent(win.navigator.userAgent);
    if (store === null) return 'badges';
    const url = storeUrl(store, links, providerToken, campaignFrom(win.location.search, 'get'));
    if (url === null) return 'badges';
    const status = win.document.querySelector<HTMLElement>('[data-get-redirecting]');
    if (status) status.hidden = false;
    // replace keeps /get out of the history, so Back from the store does not bounce here again.
    win.location.replace(url);
    return 'redirected';
  } catch {
    return 'badges';
  }
}
