// /get store choice and redirect with a fake window.
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoreLinks } from '../config';
import { mountGetPage, storeForUserAgent } from './get';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const CHROMECAST =
  'Mozilla/5.0 (Linux; Android 12; Chromecast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BRAVIA =
  'Mozilla/5.0 (Linux; Android 10; BRAVIA 4K UR3 Build/QTG3.200305.006.S292) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const FIRE_TV =
  'Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const PLAY_ONLY: StoreLinks = {
  appStore: null,
  googlePlay: 'https://play.google.com/store/apps/details?id=x',
};
const LIVE: StoreLinks = {
  appStore: 'https://apps.apple.com/app/id1',
  googlePlay: PLAY_ONLY.googlePlay,
};

function fakeWin(ua: string, search = '') {
  document.body.innerHTML =
    '<p data-get-redirecting role="status" hidden>Opening your app store…</p><ul><li>badge</li></ul>';
  const replace = vi.fn();
  const win = {
    navigator: { userAgent: ua },
    location: { search, replace },
    document,
  } as unknown as Window;
  return { win, replace };
}

const status = () => document.querySelector<HTMLElement>('[data-get-redirecting]')!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('storeForUserAgent', () => {
  it('maps iPhone to the App Store and an Android phone to Google Play', () => {
    expect(storeForUserAgent(IPHONE)).toBe('app_store');
    expect(storeForUserAgent(IPHONE.replace('iPhone', 'iPad'))).toBe('app_store');
    expect(storeForUserAgent(PIXEL)).toBe('google_play');
    expect(storeForUserAgent(PIXEL.replace('Android', 'android'))).toBe('google_play');
  });

  it('maps TVs, desktops and unknown agents to null', () => {
    for (const ua of [CHROMECAST, BRAVIA, FIRE_TV, WINDOWS, MAC, '']) {
      expect(storeForUserAgent(ua)).toBeNull();
    }
    expect(storeForUserAgent(`${PIXEL} Android TV`)).toBeNull();
    expect(storeForUserAgent('Mozilla/5.0 (Linux; Android 11; SMART-TV)')).toBeNull();
  });
});

describe('mountGetPage', () => {
  it('redirects an Android phone to Play with the campaign referrer', () => {
    const { win, replace } = fakeWin(PIXEL, '?utm_source=ig');
    expect(mountGetPage(win, { links: PLAY_ONLY })).toBe('redirected');
    expect(replace).toHaveBeenCalledTimes(1);
    const url = new URL(replace.mock.calls[0]![0] as string);
    expect(url.searchParams.get('referrer')).toBe(
      'utm_source=ig&utm_medium=organic&utm_campaign=get',
    );
    expect(status().hidden).toBe(false);
  });

  it('redirects an iPhone with ct and the provider token', () => {
    const { win, replace } = fakeWin(IPHONE, '?utm_campaign=xmas26');
    expect(mountGetPage(win, { links: LIVE, providerToken: 'PT1' })).toBe('redirected');
    const url = new URL(replace.mock.calls[0]![0] as string);
    expect(url.searchParams.get('ct')).toBe('xmas26');
    expect(url.searchParams.get('pt')).toBe('PT1');
  });

  it('stays on the badges while the store link is null', () => {
    const { win, replace } = fakeWin(IPHONE);
    const before = document.body.innerHTML;
    expect(mountGetPage(win, { links: { appStore: null, googlePlay: null } })).toBe('badges');
    expect(mountGetPage(win, { links: PLAY_ONLY })).toBe('badges');
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(before);
  });

  it('stays on the badges on a desktop or a TV', () => {
    for (const ua of [WINDOWS, CHROMECAST]) {
      const { win, replace } = fakeWin(ua);
      expect(mountGetPage(win, { links: LIVE })).toBe('badges');
      expect(replace).not.toHaveBeenCalled();
      expect(status().hidden).toBe(true);
    }
  });

  it('redirects without the status markup', () => {
    const { win, replace } = fakeWin(PIXEL);
    document.body.innerHTML = '';
    expect(mountGetPage(win, { links: PLAY_ONLY })).toBe('redirected');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('never throws', () => {
    const throwing = {
      get navigator(): Navigator {
        throw new Error('blocked');
      },
    } as unknown as Window;
    expect(mountGetPage(throwing, { links: LIVE })).toBe('badges');
    const { win } = fakeWin(PIXEL);
    expect(mountGetPage(win, { links: { appStore: null, googlePlay: '/relative' } })).toBe(
      'badges',
    );
  });
});
