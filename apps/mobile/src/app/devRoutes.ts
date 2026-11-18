// Debug builds only: `pocketnotes://dev/<route>` jumps to a screen so simulator screenshots and QA
// need no tap driver (README "Dev routes"). Declines usage statistics when unset, so the consent
// sheet does not cover the screenshot (`dev/consent` shows it instead). Routes: `home`, `settings`,
// `play` (a new game), `play-<blocks>` (a board of that size), `consent`.
import { isValidBlocks } from '@pn/core';

import type { AppAction, AppState } from './state';
import { DEFAULT_BLOCKS } from './state';

const ROUTE = /^pocketnotes:\/\/dev\/([a-z0-9-]+)$/;

/** true when `url` was a dev route (handled or unknown); false for any other URL. */
export function openDevRoute(
  url: string,
  state: AppState,
  dispatch: (a: AppAction) => void,
): boolean {
  const match = ROUTE.exec(url.trim());
  if (!match) return false;
  const route = match[1] ?? '';
  if (route !== 'consent' && state.analyticsConsent === 'unknown')
    dispatch({ type: 'SET_ANALYTICS_CONSENT', granted: false });
  const sized = /^play-(\d{1,3})$/.exec(route);
  if (route === 'home' || route === 'settings' || route === 'consent')
    dispatch({
      type: 'NAVIGATE',
      screen: route === 'consent' ? 'home' : route,
    });
  else if (route === 'play')
    dispatch({ type: 'PLAY', blocks: DEFAULT_BLOCKS, source: 'new' });
  else if (sized && isValidBlocks(Number(sized[1])))
    dispatch({ type: 'PLAY', blocks: Number(sized[1]), source: 'new' });
  else if (__DEV__) console.warn(`[dev] unknown route ${route}`);
  return true;
}
