// Native packages ship untranspiled ESM/TS; Babel compiles them. Native modules are mocked in
// jest.setup.ts.
const TRANSFORMED = [
  'react-native',
  '@react-native',
  '@react-native-firebase',
  'react-native-[a-z0-9-]+',
  '@react-native-async-storage',
  '@testing-library',
  '@pn',
  'expo',
  'expo-[a-z0-9-]+',
  'expo-modules-core',
];

module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/'],
  // xcodebuild's derived data (ios/build) holds copies of node_modules packages.
  modulePathIgnorePatterns: ['<rootDir>/ios/build/', '<rootDir>/android/'],
  transformIgnorePatterns: [`node_modules/(?!(${TRANSFORMED.join('|')})/)`],
  moduleNameMapper: {
    '^@babel/runtime$': '<rootDir>/node_modules/@babel/runtime',
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    // The shared packages' imports resolve from this app, as in metro.config.js.
    '^@pn/(core|design-tokens|i18n)$': '<rootDir>/node_modules/@pn/$1',
  },
};
