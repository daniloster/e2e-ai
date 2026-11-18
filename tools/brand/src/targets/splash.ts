// Every native splash resource for iOS and Android, light and dark (react-native-bootsplash's
// layout; never run its own generator), plus apps/mobile/src/brand/splash.ts for the JS side.
// The logo is the splash mark at its own size in a 128 dp box; Android draws it centred in the
// 288 dp Android 12 icon canvas, as bootsplash expects.
import { BRAND_MARK, markBounds } from '../mark';
import { OUTLINE_WIDTH } from '../palettes';
import { ANDROID_RES, APP_BRAND, DENSITIES, IOS_APP, IOS_ASSETS } from '../paths';
import { renderPng } from '../png';
import { SPLASH_CONSTANTS } from '../splashConstants';
import { launchStoryboard } from '../storyboard';
import { markDocument, toSvg } from '../svg';
import type { FileMap, MarkDocument } from '../types';
import { xcodeJson } from '../xcodeJson';

export type SplashVariant = 'splashLight' | 'splashDark';

/** The Android 12 splash icon canvas, in dp. */
const ANDROID_ICON_DP = 288;

function scaledWidth(dp: number, scale: number): number {
  const px = dp * scale;
  if (!Number.isInteger(px) || px <= 0) {
    throw new RangeError(`${dp} dp at scale ${scale} is not a whole number of pixels`);
  }
  return px;
}

/** Largest mark size whose outlined shapes stay inside a centred box of `box` units. */
function fitBox(box: number): number {
  const b = markBounds(BRAND_MARK);
  const pad = OUTLINE_WIDTH / 2;
  const half = Math.max(
    60 - (b.minX - pad),
    b.maxX + pad - 60,
    60 - (b.minY - pad),
    b.maxY + pad - 60,
  );
  return Math.floor(((box / 2) * 120 * 100) / half) / 100;
}

/** 288-canvas splash mark centred in a 128-unit logo box, no ground. */
export function splashLogoDocument(variant: SplashVariant): MarkDocument {
  const doc = markDocument(variant, ANDROID_ICON_DP);
  const box = SPLASH_CONSTANTS.logoWidthDp;
  return {
    ...doc,
    palette: { ...doc.palette, ground: null },
    placement: { canvas: box, markSize: Math.min(doc.placement.markSize, fitBox(box)) },
  };
}

/** The same mark on the 288-unit Android 12 icon canvas (bootsplash's Android logo layout). */
export function splashAndroidLogoDocument(variant: SplashVariant): MarkDocument {
  const logo = splashLogoDocument(variant);
  return { ...logo, placement: { canvas: ANDROID_ICON_DP, markSize: logo.placement.markSize } };
}

/** Transparent logo PNG, 128 * scale px square. */
export function splashLogoPng(variant: SplashVariant, scale: number): Uint8Array {
  const px = scaledWidth(SPLASH_CONSTANTS.logoWidthDp, scale);
  return renderPng(toSvg(splashLogoDocument(variant)), px);
}

/** Transparent Android logo PNG, 288 * scale px square with the 128 dp logo centred. */
export function splashAndroidLogoPng(variant: SplashVariant, scale: number): Uint8Array {
  const px = scaledWidth(ANDROID_ICON_DP, scale);
  return renderPng(toSvg(splashAndroidLogoDocument(variant)), px);
}

type Entry = readonly [path: string, contents: Uint8Array | string];
/** Renders shared by the iOS and JS sections of one buildSplashFiles call. */
type LogoCache = Map<string, Uint8Array>;

const LOGO_SET = `${IOS_ASSETS}/BootSplashLogo.imageset`;
const BACKGROUND_SET = `${IOS_ASSETS}/BootSplashBackground.colorset`;
const IOS_SCALES = [1, 2, 3] as const;
const DARK = [{ appearance: 'luminosity', value: 'dark' }] as const;

function logo(cache: LogoCache, variant: SplashVariant, scale: number): Uint8Array {
  const key = `${variant}@${scale}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const png = splashLogoPng(variant, scale);
  cache.set(key, png);
  return png;
}

function logoName(variant: SplashVariant, scale: number): string {
  return `logo-${variant === 'splashLight' ? 'light' : 'dark'}${scale === 1 ? '' : `@${scale}x`}.png`;
}

/** Xcode's hex form of an sRGB colour: 0x + two uppercase digits per channel. */
function xcodeColor(hex: string): object {
  const c = (i: number): string => `0x${hex.slice(i, i + 2).toUpperCase()}`;
  return {
    'color-space': 'srgb',
    components: { alpha: '1.000', blue: c(5), green: c(3), red: c(1) },
  };
}

function logoSetContents(): string {
  return xcodeJson({
    images: IOS_SCALES.flatMap((scale) => [
      { filename: logoName('splashLight', scale), idiom: 'universal', scale: `${scale}x` },
      {
        appearances: DARK,
        filename: logoName('splashDark', scale),
        idiom: 'universal',
        scale: `${scale}x`,
      },
    ]),
    info: { author: 'xcode', version: 1 },
  });
}

function backgroundSetContents(): string {
  const { light, dark } = SPLASH_CONSTANTS.background;
  return xcodeJson({
    colors: [
      { color: xcodeColor(light), idiom: 'universal' },
      { appearances: DARK, color: xcodeColor(dark), idiom: 'universal' },
    ],
    info: { author: 'xcode', version: 1 },
  });
}

function iosSplashEntries(cache: LogoCache): Entry[] {
  const logos = (['splashLight', 'splashDark'] as const).flatMap((variant) =>
    IOS_SCALES.map((scale): Entry => [
      `${LOGO_SET}/${logoName(variant, scale)}`,
      logo(cache, variant, scale),
    ]),
  );
  return [
    ...logos,
    [`${LOGO_SET}/Contents.json`, logoSetContents()],
    [`${BACKGROUND_SET}/Contents.json`, backgroundSetContents()],
    [`${IOS_APP}/LaunchScreen.storyboard`, launchStoryboard()],
  ];
}

function backgroundColorXml(color: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    `  <color name="bootsplash_background">${color}</color>`,
    '</resources>',
    '',
  ].join('\n');
}

/** Day and night drawables per density (night before density: Android's qualifier order). */
function androidSplashEntries(): Entry[] {
  const logos = DENSITIES.flatMap(({ name, scale }): Entry[] => [
    [
      `${ANDROID_RES}/drawable-${name}/bootsplash_logo.png`,
      splashAndroidLogoPng('splashLight', scale),
    ],
    [
      `${ANDROID_RES}/drawable-night-${name}/bootsplash_logo.png`,
      splashAndroidLogoPng('splashDark', scale),
    ],
  ]);
  return [
    ...logos,
    [`${ANDROID_RES}/values/bootsplash.xml`, backgroundColorXml(SPLASH_CONSTANTS.background.light)],
    [
      `${ANDROID_RES}/values-night/bootsplash.xml`,
      backgroundColorXml(SPLASH_CONSTANTS.background.dark),
    ],
  ];
}

/** The generated module the app imports (splash colours and logo). Colours are literals, so it
 * changes only on regeneration, together with the native resources. */
function splashModuleSource(): string {
  const { logoWidthDp, background } = SPLASH_CONSTANTS;
  return `// Generated by tools/brand (npm run brand -- --targets splash) - do not edit.
/* eslint-disable @typescript-eslint/no-require-imports -- React Native static image requires */
import type { ImageSourcePropType } from 'react-native';

export interface SplashConstants {
  logoWidthDp: ${logoWidthDp};
  background: { light: string; dark: string };
}

export const SPLASH: SplashConstants = {
  logoWidthDp: ${logoWidthDp},
  background: { light: '${background.light}', dark: '${background.dark}' },
};

export const SPLASH_LOGO: Readonly<{
  light: ImageSourcePropType;
  dark: ImageSourcePropType;
}> = {
  light: require('./splash-logo-light.png'),
  dark: require('./splash-logo-dark.png'),
};
`;
}

function jsModuleEntries(cache: LogoCache): Entry[] {
  const logos = (['splashLight', 'splashDark'] as const).flatMap((variant) =>
    IOS_SCALES.map((scale): Entry => [
      `${APP_BRAND}/splash-${logoName(variant, scale)}`,
      logo(cache, variant, scale),
    ]),
  );
  return [...logos, [`${APP_BRAND}/splash.ts`, splashModuleSource()]];
}

export function buildSplashFiles(): FileMap {
  const cache: LogoCache = new Map();
  return new Map([
    ...iosSplashEntries(cache),
    ...androidSplashEntries(),
    ...jsModuleEntries(cache),
  ]);
}
