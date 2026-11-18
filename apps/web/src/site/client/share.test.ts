import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_OPEN_TIMEOUT_MS, appShareUrl, mountShareLanding, sharePayloadOf } from './share';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const LIVE = {
  appStore: 'https://apps.apple.com/app/id1',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.pocketnotes',
};

function markup(): void {
  document.body.innerHTML = `
    <p data-share-opening hidden></p>
    <p data-share-invalid hidden></p>
    <p data-share-open hidden><a data-share-app-link href="pocketnotes://s">open</a></p>`;
}

function fakeWindow(hash: string, ua = IPHONE) {
  const assign = vi.fn();
  const win = {
    document,
    navigator: { userAgent: ua },
    location: { hash, search: '', assign },
    setTimeout: vi.fn(),
  } as unknown as Window;
  return { win, assign };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('sharePayloadOf', () => {
  it.each([
    ['#AbC-_09', 'AbC-_09'],
    ['AbC', 'AbC'],
    ['', null],
    ['#', null],
    ['#a b', null],
    ['#a=', null],
    [`#${'a'.repeat(4097)}`, null],
  ] as const)('%j -> %j', (hash, payload) => {
    expect(sharePayloadOf(hash)).toBe(payload);
  });

  it('builds the custom-scheme URL', () => {
    expect(appShareUrl('xyz')).toBe('pocketnotes://s#xyz');
  });
});

describe('mountShareLanding', () => {
  it('shows the invalid message for an empty fragment and never navigates', () => {
    markup();
    const { win, assign } = fakeWindow('');
    expect(mountShareLanding(win)).toBe('invalid');
    expect(document.querySelector<HTMLElement>('[data-share-invalid]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-share-open]')!.hidden).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it('opens the app, then falls back to the store while the page stays visible', () => {
    markup();
    const { win, assign } = fakeWindow('#abc');
    let timer: (() => void) | undefined;
    const setTimer = vi.fn((run: () => void) => {
      timer = run;
    });
    expect(mountShareLanding(win, { links: LIVE, providerToken: null, setTimer })).toBe('opening');
    expect(assign).toHaveBeenCalledWith('pocketnotes://s#abc');
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), APP_OPEN_TIMEOUT_MS);
    expect(document.querySelector<HTMLAnchorElement>('[data-share-app-link]')!.href).toBe(
      'pocketnotes://s#abc',
    );
    timer!();
    expect(assign).toHaveBeenLastCalledWith('https://apps.apple.com/app/id1?ct=share');
    expect(document.querySelector<HTMLElement>('[data-share-opening]')!.hidden).toBe(true);
  });

  it('stays on the badges while no store link exists', () => {
    markup();
    const { win, assign } = fakeWindow('#abc');
    mountShareLanding(win, {
      links: { appStore: null, googlePlay: null },
      setTimer: (run) => run(),
    });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('stays on the badges on a desktop', () => {
    markup();
    const { win, assign } = fakeWindow('#abc', 'Mozilla/5.0 (Macintosh)');
    mountShareLanding(win, { links: LIVE, setTimer: (run) => run() });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('never throws', () => {
    markup();
    const win = {
      document,
      get location(): Location {
        throw new Error('blocked');
      },
    } as unknown as Window;
    expect(mountShareLanding(win)).toBe('invalid');
  });
});
