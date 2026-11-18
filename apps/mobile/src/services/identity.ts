// The device unique ID behind the player ID, and what the build says about it. The only file in the
// app that imports react-native-device-info. getUniqueId is DeviceUID in the iOS Keychain and
// ANDROID_ID on Android; it is remembered in AsyncStorage (pn.deviceId) so a launch that cannot read
// it keeps the same player ID, and a random ID is made only when it was never read.
// ANDROID_ID is per signing key: debug, sideloaded and Play installs each get their own (by design;
// the legal pages say so), which isTestInstall lets Settings explain.
import {
  CryptoDigestAlgorithm,
  digestStringAsync,
  getRandomBytes,
} from 'expo-crypto';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

import { recordError } from './analytics';
import { getDeviceId, setDeviceId } from './storage';

const PLAY_STORE_INSTALLER = 'com.android.vending';

/** Final from the first release: changing it gives every player a new player ID. */
export const PLAYER_ID_SALT = 'com.pocketnotes.player-id.v1';
export const PLAYER_ID = /^[0-9A-F]{8}$/;

function randomHex32(): string {
  return Array.from(getRandomBytes(16), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

async function nativeUniqueId(): Promise<string | null> {
  try {
    const id = await DeviceInfo.getUniqueId();
    if (typeof id === 'string' && id.length > 0) return id;
    recordError(new Error('empty unique id'), 'identity.unique_id', 'identity');
  } catch (error) {
    recordError(error, 'identity.unique_id', 'identity');
  }
  return null;
}

/** Never rejects. */
export async function deviceUniqueId(): Promise<string> {
  const native = await nativeUniqueId();
  const stored = await getDeviceId();
  if (native) {
    if (native !== stored) await setDeviceId(native);
    return native;
  }
  if (stored) return stored;
  const fresh = randomHex32();
  await setDeviceId(fresh);
  return fresh;
}

/**
 * The player ID shown in Settings: 8 upper-case hex characters of SHA-256(salt ‖ device ID). The
 * device ID never leaves the phone; only this short ID would.
 */
export async function playerIdOf(
  deviceId: string,
  salt: string = PLAYER_ID_SALT,
): Promise<string> {
  const hex = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    salt + deviceId,
  );
  return hex.slice(0, 8).toUpperCase();
}

/**
 * True for an Android build whose player ID differs from the Play Store app's: a debug build or a
 * sideloaded APK (signed with another key, so another ANDROID_ID). False on iOS, where the ID does
 * not depend on the build, and when the installer cannot be read. Never rejects.
 */
export async function isTestInstall(
  os: typeof Platform.OS = Platform.OS,
  dev: boolean = __DEV__,
): Promise<boolean> {
  if (os !== 'android') return false;
  if (dev) return true;
  try {
    return (
      (await DeviceInfo.getInstallerPackageName()) !== PLAY_STORE_INSTALLER
    );
  } catch (error) {
    recordError(error, 'identity.installer', 'identity');
    return false;
  }
}

/** "1.0.0 (1)": the marketing version and the build number. Never throws. */
export function appVersion(): string {
  try {
    return `${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`;
  } catch {
    return '';
  }
}
