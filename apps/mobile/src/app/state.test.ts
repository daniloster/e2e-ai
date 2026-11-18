import { DEFAULT_BLOCKS, initialState, reducer } from './state';

describe('app reducer', () => {
  it('hydrates the stored values', () => {
    const s = reducer(initialState, {
      type: 'HYDRATE',
      locale: 'es',
      analyticsConsent: 'denied',
      best: 12,
    });
    expect(s).toMatchObject({
      hydrated: true,
      locale: 'es',
      analyticsConsent: 'denied',
      best: 12,
    });
  });

  it('navigates, and returns the same state for the current screen', () => {
    const s = reducer(initialState, { type: 'NAVIGATE', screen: 'settings' });
    expect(s.screen).toBe('settings');
    expect(reducer(s, { type: 'NAVIGATE', screen: 'settings' })).toBe(s);
  });

  it('starts a new play request with a fresh nonce each time', () => {
    const a = reducer(initialState, {
      type: 'PLAY',
      blocks: DEFAULT_BLOCKS,
      source: 'new',
    });
    const b = reducer(a, { type: 'PLAY', blocks: 7, source: 'link' });
    expect(a.screen).toBe('play');
    expect(b.play).toEqual({ blocks: 7, source: 'link', nonce: 2 });
  });

  it('records only a better score', () => {
    const a = reducer(initialState, { type: 'RECORD_SCORE', score: 10 });
    expect(a.best).toBe(10);
    expect(reducer(a, { type: 'RECORD_SCORE', score: 9 })).toBe(a);
    expect(reducer(a, { type: 'RECORD_SCORE', score: 11 }).best).toBe(11);
  });

  it('stores the consent choice and the player id', () => {
    const a = reducer(initialState, {
      type: 'SET_ANALYTICS_CONSENT',
      granted: true,
    });
    expect(a.analyticsConsent).toBe('granted');
    const b = reducer(a, {
      type: 'SET_PLAYER_ID',
      playerId: 'ABCD1234',
      testInstall: true,
    });
    expect(b).toMatchObject({ playerId: 'ABCD1234', testInstall: true });
  });
});
