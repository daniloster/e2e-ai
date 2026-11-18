import { openDevRoute } from './devRoutes';
import { initialState } from './state';

describe('openDevRoute', () => {
  it('ignores other URLs', () => {
    const dispatch = jest.fn();
    expect(openDevRoute('pocketnotes://s#AQAAFA', initialState, dispatch)).toBe(
      false,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('declines usage statistics when unset, then navigates', () => {
    const dispatch = jest.fn();
    expect(
      openDevRoute('pocketnotes://dev/settings', initialState, dispatch),
    ).toBe(true);
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'SET_ANALYTICS_CONSENT', granted: false }],
      [{ type: 'NAVIGATE', screen: 'settings' }],
    ]);
  });

  it('starts a game of the requested size and leaves consent open for dev/consent', () => {
    const dispatch = jest.fn();
    openDevRoute('pocketnotes://dev/play-7', initialState, dispatch);
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'PLAY',
      blocks: 7,
      source: 'new',
    });
    dispatch.mockClear();
    openDevRoute('pocketnotes://dev/consent', initialState, dispatch);
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'NAVIGATE', screen: 'home' }],
    ]);
  });
});
