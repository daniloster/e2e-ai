import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';

import { AppProvider } from '../app/AppProvider';
import { fakeServices } from '../testing/fakeServices';
import { IconButton } from './IconButton';
import { ScreenHeader } from './ScreenHeader';
import { Toast } from './Toast';
import { useDelayedVisibility } from './useDelayedVisibility';

describe('IconButton', () => {
  it('is a labelled button with a 44 pt touch area', async () => {
    const onPress = jest.fn();
    await render(
      <IconButton testID="b" art="share" label="Share" onPress={onPress} />,
    );
    const button = screen.getByRole('button', { name: 'Share' });
    expect(button.props.hitSlop).toBe(4);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('ScreenHeader', () => {
  it('shows the title as a header and Back when there is somewhere to go', async () => {
    const onBack = jest.fn();
    await render(
      <AppProvider services={fakeServices({ consent: false })}>
        <ScreenHeader title="Settings" onBack={onBack} />
      </AppProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs its action, then hides itself', async () => {
    const onAction = jest.fn();
    const onHide = jest.fn();
    await render(
      <Toast
        toast={{ message: 'Done', actionLabel: 'Undo', onAction }}
        onHide={onHide}
      />,
    );
    expect(screen.getByTestId('toast')).toHaveTextContent(/Done/);
    await fireEvent.press(screen.getByTestId('toast-action'));
    expect(onAction).toHaveBeenCalled();
    expect(onHide).toHaveBeenCalled();
  });

  it('hides itself after its duration', async () => {
    const onHide = jest.fn();
    await render(
      <Toast toast={{ message: 'Saved' }} onHide={onHide} durationMs={1000} />,
    );
    await act(async () => jest.advanceTimersByTime(999));
    expect(onHide).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(onHide).toHaveBeenCalled();
  });
});

describe('useDelayedVisibility', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows nothing for quick work', async () => {
    const { result, rerender } = await renderHook(
      ({ v }: { v: boolean }) => useDelayedVisibility(v, 300, 600),
      { initialProps: { v: true } },
    );
    await act(async () => jest.advanceTimersByTime(200));
    await rerender({ v: false });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('appears after the delay and stays for the minimum time', async () => {
    const { result, rerender } = await renderHook(
      ({ v }: { v: boolean }) => useDelayedVisibility(v, 300, 600),
      { initialProps: { v: true } },
    );
    await act(async () => jest.advanceTimersByTime(300));
    expect(result.current).toBe(true);
    await rerender({ v: false });
    await act(async () => jest.advanceTimersByTime(500));
    expect(result.current).toBe(true);
    await act(async () => jest.advanceTimersByTime(100));
    expect(result.current).toBe(false);
  });
});
