import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getAnalyticsConsent,
  getBest,
  getDeviceId,
  getLocale,
  setAnalyticsConsent,
  setBest,
  setDeviceId,
  setLocale,
  STORAGE_KEYS,
} from './storage';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('storage', () => {
  it('uses the pn. prefix for every key', () => {
    for (const key of Object.values(STORAGE_KEYS))
      expect(key.startsWith('pn.')).toBe(true);
  });

  it('round-trips each value', async () => {
    await setLocale('pt-BR');
    await setDeviceId('abc-123');
    await setAnalyticsConsent(true, 42);
    await setBest(17, 9);
    expect(await getLocale()).toBe('pt-BR');
    expect(await getDeviceId()).toBe('abc-123');
    expect(await getAnalyticsConsent()).toEqual({
      v: 1,
      analytics: true,
      atMs: 42,
    });
    expect(await getBest()).toBe(17);
  });

  it('returns null for missing values', async () => {
    expect(await getLocale()).toBeNull();
    expect(await getAnalyticsConsent()).toBeNull();
    expect(await getBest()).toBeNull();
  });

  it('removes corrupt or wrongly shaped entries', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.analyticsConsent, '{not json');
    await AsyncStorage.setItem(STORAGE_KEYS.locale, JSON.stringify('fr'));
    await AsyncStorage.setItem(
      STORAGE_KEYS.best,
      JSON.stringify({ v: 2, score: 3, atMs: 0 }),
    );
    expect(await getAnalyticsConsent()).toBeNull();
    expect(await getLocale()).toBeNull();
    expect(await getBest()).toBeNull();
    expect(
      await AsyncStorage.getItem(STORAGE_KEYS.analyticsConsent),
    ).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.locale)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.best)).toBeNull();
  });

  it('never rejects when AsyncStorage fails', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('io'));
    await expect(getBest()).resolves.toBeNull();
    await expect(setBest(1, 1)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
