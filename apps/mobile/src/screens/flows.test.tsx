import { encodeShare } from '@pn/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';

import { AppProvider } from '../app/AppProvider';
import { ScreenSwitch } from '../app/ScreenSwitch';
import { fakeServices } from '../testing/fakeServices';
import type { FakeServices } from '../testing/fakeServices';

async function renderApp(services: FakeServices) {
  await render(
    <AppProvider services={services}>
      <ScreenSwitch />
    </AppProvider>,
  );
  // Hydration, the player ID and the initial link all settle on resolved promises.
  await act(async () => undefined);
}

describe('app flows', () => {
  it('asks for consent once and stores the answer', async () => {
    const services = fakeServices();
    await renderApp(services);
    await fireEvent.press(screen.getByTestId('consent-deny'));
    await act(async () => undefined);
    expect(services.stored.consent).toEqual({
      v: 1,
      analytics: false,
      atMs: 1000,
    });
    expect(screen.queryByTestId('consent-deny')).toBeNull();
  });

  it('plays a board to the end, records the best score and undoes the last dig', async () => {
    const services = fakeServices({ consent: false });
    await renderApp(services);
    expect(screen.getByTestId('home-best')).toHaveTextContent('No score yet');
    await fireEvent.press(screen.getByTestId('home-play'));
    expect(screen.getByTestId('play-left')).toHaveTextContent('20 blocks left');

    await fireEvent.press(screen.getByTestId('play-strength-3'));
    for (let i = 0; i < 6; i++)
      await fireEvent.press(screen.getByTestId('play-dig'));
    expect(screen.getByTestId('play-left')).toHaveTextContent('2 blocks left');
    await fireEvent.press(screen.getByTestId('play-dig'));
    expect(screen.getByTestId('play-left')).toHaveTextContent('No blocks left');
    expect(screen.getByTestId('toast')).toHaveTextContent(
      /Board cleared in 7 moves!/,
    );
    expect(services.stored.best).toBe(20);

    await fireEvent.press(screen.getByTestId('toast-action'));
    expect(screen.getByTestId('play-left')).toHaveTextContent('2 blocks left');

    await fireEvent.press(screen.getByTestId('header-back'));
    expect(screen.getByTestId('home-best')).toHaveTextContent('Best score: 20');
  });

  it('shares the board as a link', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const services = fakeServices({ consent: false });
    await renderApp(services);
    await fireEvent.press(screen.getByTestId('home-play'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('play-share'));
    });
    expect(shareSpy).toHaveBeenCalledWith({
      message: expect.stringContaining(
        `https://pocketnotes.app/s#${encodeShare({ blocks: 20 })}`,
      ),
    });
    expect(services.events).toContainEqual({
      name: 'game_shared',
      params: { blocks: 20 },
    });
    shareSpy.mockRestore();
  });

  it('opens a share link at launch and while running', async () => {
    const services = fakeServices({
      consent: false,
      initialUrl: `pocketnotes://s#${encodeShare({ blocks: 5 })}`,
    });
    await renderApp(services);
    expect(screen.getByTestId('play-left')).toHaveTextContent('5 blocks left');
    await act(async () => {
      services.openUrl(
        `https://pocketnotes.app/s#${encodeShare({ blocks: 9 })}`,
      );
    });
    expect(screen.getByTestId('play-left')).toHaveTextContent('9 blocks left');
  });

  it('explains a damaged link', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const services = fakeServices({ consent: false });
    await renderApp(services);
    await act(async () => {
      services.openUrl('pocketnotes://s#AQ');
    });
    expect(alert).toHaveBeenCalledWith(
      'Link not opened',
      'This link is damaged or incomplete. Ask for a new one.',
    );
    alert.mockRestore();
  });

  it('shows the player ID, the test-build note and the consent switch in Settings', async () => {
    const services = fakeServices({ consent: false, testInstall: true });
    await renderApp(services);
    await fireEvent.press(screen.getByTestId('home-settings'));
    expect(screen.getByTestId('settings-player-id')).toHaveTextContent(
      'ABCD1234',
    );
    expect(screen.getByTestId('settings-test-build')).toBeTruthy();
    await fireEvent(
      screen.getByTestId('settings-analytics'),
      'valueChange',
      true,
    );
    await act(async () => undefined);
    expect(services.stored.consent?.analytics).toBe(true);
    expect(services.events).toContainEqual({
      name: 'consent_choice',
      params: { granted: true },
    });
  });
});
