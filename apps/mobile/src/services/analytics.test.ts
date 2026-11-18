// The RNFirebase doubles from jest.setup.ts, read with requireMock: only the facade imports Firebase.
const { logEvent, setAnalyticsCollectionEnabled } = jest.requireMock<{
  logEvent: jest.Mock;
  setAnalyticsCollectionEnabled: jest.Mock;
}>('@react-native-firebase/analytics');
const {
  deleteUnsentReports,
  log,
  recordError: rnfbRecordError,
  setCrashlyticsCollectionEnabled,
} = jest.requireMock<{
  deleteUnsentReports: jest.Mock;
  log: jest.Mock;
  recordError: jest.Mock;
  setCrashlyticsCollectionEnabled: jest.Mock;
}>('@react-native-firebase/crashlytics');

import {
  breadcrumb,
  recordError,
  sanitizeText,
  setCollectionEnabled,
  track,
} from './analytics';

beforeEach(async () => {
  await setCollectionEnabled(false);
  jest.clearAllMocks();
});

describe('consent gate', () => {
  it('sends nothing before the user allows usage statistics', async () => {
    await track({ name: 'game_start', params: { source: 'new', blocks: 20 } });
    breadcrumb('screen:play');
    recordError(new Error('boom'), 'game.reduce', 'game');
    expect(logEvent).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(rnfbRecordError).not.toHaveBeenCalled();
  });

  it('sends events once allowed, and stops again when withdrawn', async () => {
    await setCollectionEnabled(true);
    expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith({}, true);
    expect(setCrashlyticsCollectionEnabled).toHaveBeenCalledWith({}, true);
    await track({ name: 'game_cleared', params: { moves: 4, score: 20 } });
    expect(logEvent).toHaveBeenCalledWith({}, 'game_cleared', {
      moves: 4,
      score: 20,
    });

    await setCollectionEnabled(false);
    expect(deleteUnsentReports).toHaveBeenCalled();
    await track({ name: 'game_cleared', params: { moves: 5, score: 20 } });
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('never rejects when Firebase throws', async () => {
    await setCollectionEnabled(true);
    logEvent.mockRejectedValueOnce(new Error('offline'));
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await expect(
      track({ name: 'consent_choice', params: { granted: true } }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('recordError', () => {
  it('records a Crashlytics non-fatal and an app_error event with stable ids only', async () => {
    await setCollectionEnabled(true);
    recordError(
      new Error('failed at https://example.com/s#secret?x=1'),
      'storage.read',
      'storage',
    );
    expect(rnfbRecordError).toHaveBeenCalledTimes(1);
    const sent = rnfbRecordError.mock.calls[0][1] as Error;
    expect(sent.message).toBe('failed at [url]');
    expect(log).toHaveBeenCalledWith({}, 'storage:storage.read');
    expect(logEvent).toHaveBeenCalledWith({}, 'app_error', {
      code: 'storage.read',
      area: 'storage',
      fatal: false,
    });
  });

  it('replaces a code that is not a static identifier', async () => {
    await setCollectionEnabled(true);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    recordError('nope', 'has spaces and text', 'app');
    warn.mockRestore();
    expect(logEvent).toHaveBeenCalledWith({}, 'app_error', {
      code: 'invalid',
      area: 'app',
      fatal: false,
    });
    const sent = rnfbRecordError.mock.calls[0][1] as Error;
    expect(sent.message).toBe('NonError: string');
  });
});

describe('sanitizeText', () => {
  it('strips urls and queries, collapses whitespace and truncates', () => {
    expect(sanitizeText('a  b\n c?token=1')).toBe('a b c');
    expect(sanitizeText('x'.repeat(200))).toHaveLength(100);
  });
});
