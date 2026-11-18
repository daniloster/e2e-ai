// Native module mocks for every Jest test. Override per test with jest.mocked(fn).
jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn(async () => undefined),
  setAnalyticsCollectionEnabled: jest.fn(async () => undefined),
}));

jest.mock('@react-native-firebase/crashlytics', () => ({
  getCrashlytics: jest.fn(() => ({})),
  log: jest.fn(),
  recordError: jest.fn(),
  crash: jest.fn(),
  setCrashlyticsCollectionEnabled: jest.fn(async () => null),
  deleteUnsentReports: jest.fn(async () => undefined),
}));

// AsyncStorage 3.x ships its in-memory mock at the /jest export (same module shape).
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest'),
);

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getUniqueId: jest.fn(async () => 'test-device-id'),
    getInstallerPackageName: jest.fn(async () => 'com.android.vending'),
    getVersion: jest.fn(() => '1.0.0'),
    getBuildNumber: jest.fn(() => '1'),
  },
  getUniqueId: jest.fn(async () => 'test-device-id'),
  getInstallerPackageName: jest.fn(async () => 'com.android.vending'),
  isEmulatorSync: jest.fn(() => false),
}));

// SafeAreaProvider renders nothing until it measures the screen; the library's mock supplies metrics.
jest.mock(
  'react-native-safe-area-context',
  () =>
    jest.requireActual<{ default: object }>(
      'react-native-safe-area-context/jest/mock',
    ).default,
);

jest.mock('react-native-bootsplash', () => {
  const api = {
    hide: jest.fn(async () => undefined),
    isVisible: jest.fn(() => false),
  };
  return { __esModule: true, default: api, ...api };
});

// The Keychain / Keystore as an in-memory map.
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
    getItemAsync: jest.fn(async (key: string) => items.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      items.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      items.delete(key);
    }),
  };
});

// The CSPRNG and SHA-256 from Node.
jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual<{
    randomBytes: (n: number) => Uint8Array;
    createHash: (algorithm: string) => {
      update: (
        data: string,
        encoding: string,
      ) => { digest: (encoding: string) => string };
    };
  }>('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytes: jest.fn((count: number) =>
      Uint8Array.from(nodeCrypto.randomBytes(count)),
    ),
    digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
      nodeCrypto.createHash('sha256').update(data, 'utf8').digest('hex'),
    ),
  };
});

// The analytics facade logs every event with console.debug in __DEV__; keep test output readable.
jest.spyOn(console, 'debug').mockImplementation(() => undefined);

