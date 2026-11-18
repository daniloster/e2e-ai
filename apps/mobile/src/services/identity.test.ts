import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

import { recordError } from './analytics';
import {
  deviceUniqueId,
  isTestInstall,
  PLAYER_ID,
  playerIdOf,
} from './identity';
import { STORAGE_KEYS } from './storage';

jest.mock('./analytics', () => ({ recordError: jest.fn() }));

const getUniqueId = jest.mocked(DeviceInfo.getUniqueId);
const getInstaller = jest.mocked(DeviceInfo.getInstallerPackageName);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

async function stored(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  return raw === null ? null : (JSON.parse(raw) as string);
}

describe('deviceUniqueId', () => {
  it('returns the native id and remembers it', async () => {
    getUniqueId.mockResolvedValueOnce('a1b2c3d4e5f60718');
    expect(await deviceUniqueId()).toBe('a1b2c3d4e5f60718');
    expect(await stored()).toBe('a1b2c3d4e5f60718');
  });

  it('falls back to the remembered id when the native one cannot be read', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.deviceId,
      JSON.stringify('remembered-1'),
    );
    getUniqueId.mockRejectedValueOnce(new Error('keychain'));
    expect(await deviceUniqueId()).toBe('remembered-1');
    expect(recordError).toHaveBeenCalledWith(
      expect.any(Error),
      'identity.unique_id',
      'identity',
    );
  });

  it('makes and keeps a random id when none was ever read', async () => {
    getUniqueId.mockResolvedValue('');
    const first = await deviceUniqueId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await deviceUniqueId()).toBe(first);
    getUniqueId.mockReset();
  });
});

describe('playerIdOf', () => {
  it('is 8 stable upper-case hex characters', async () => {
    const id = await playerIdOf('test-device-id');
    expect(id).toMatch(PLAYER_ID);
    expect(await playerIdOf('test-device-id')).toBe(id);
    expect(await playerIdOf('other-device')).not.toBe(id);
  });
});

describe('isTestInstall', () => {
  it('is false on iOS', async () => {
    expect(await isTestInstall('ios', true)).toBe(false);
  });

  it('is true for an Android debug build', async () => {
    expect(await isTestInstall('android', true)).toBe(true);
  });

  it('is false for a Play Store install and true for a sideloaded one', async () => {
    expect(await isTestInstall('android', false)).toBe(false);
    getInstaller.mockResolvedValueOnce('com.google.android.packageinstaller');
    expect(await isTestInstall('android', false)).toBe(true);
  });

  it('is false and reports when the installer cannot be read', async () => {
    getInstaller.mockRejectedValueOnce(new Error('nope'));
    expect(await isTestInstall('android', false)).toBe(false);
    expect(recordError).toHaveBeenCalledWith(
      expect.any(Error),
      'identity.installer',
      'identity',
    );
  });
});
