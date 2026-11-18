// Where the generator's files go: repo-relative POSIX roots, joined with template strings so map
// keys are the same on every OS, and the Android densities. Shared by every target.
import type { Density } from './types';

export const APP_BRAND = 'apps/mobile/src/brand';
export const IOS_APP = 'apps/mobile/ios/PocketNotes';
export const IOS_ASSETS = 'apps/mobile/ios/PocketNotes/Images.xcassets';
export const ANDROID_RES = 'apps/mobile/android/app/src/main/res';
/** Debug build type overrides: the DEV-ribboned launcher icon. */
export const ANDROID_DEBUG_RES = 'apps/mobile/android/app/src/debug/res';
/** The product site's brand assets. */
export const SITE_ASSET_DIR = 'apps/web/public/site';

export const DENSITIES: readonly Density[] = Object.freeze(
  (
    [
      { name: 'mdpi', scale: 1 },
      { name: 'hdpi', scale: 1.5 },
      { name: 'xhdpi', scale: 2 },
      { name: 'xxhdpi', scale: 3 },
      { name: 'xxxhdpi', scale: 4 },
    ] as const
  ).map((d) => Object.freeze({ ...d })),
);
