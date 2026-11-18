// Every app-icon file for both platforms as a FileMap. iOS: one 1024 px image per appearance (Any
// opaque for the App Store, Dark and Tinted transparent). The map is built in write order: images
// before the files that reference them. Android: an adaptive icon (UI background ground,
// full-colour foreground, monochrome layer for themed icons), legacy PNGs for API
// 24-25 under the template's names, and the 512 px Play Store icon. Debug builds get the same icons
// with a DEV ribbon: iOS's AppIcon-Dev set (picked by the Debug configuration's
// ASSETCATALOG_COMPILER_APPICON_NAME) and Android's src/debug/res overrides.
import { UI_COLORS } from '@pn/design-tokens';

import {
  CIRCLE_FIT,
  CORNER_FIT,
  RIBBON_COLOURS,
  ribbonSvg,
  withRibbonSvg,
  withRibbonVector,
} from '../devRibbon';
import { ANDROID_DEBUG_RES, ANDROID_RES, DENSITIES, IOS_ASSETS } from '../paths';
import { placementFor } from '../placement';
import { renderPng } from '../png';
import { markDocument, toSvg } from '../svg';
import type { FileMap, MarkDocument } from '../types';
import { toVectorDrawable } from '../vectorDrawable';
import { xcodeJson } from '../xcodeJson';

type Entry = readonly [path: string, contents: Uint8Array | string];

const APP_ICON_SET = `${IOS_ASSETS}/AppIcon.appiconset`;
const DEV_ICON_SET = `${IOS_ASSETS}/AppIcon-Dev.appiconset`;
const IOS_ICON_PX = 1024;
const ADAPTIVE_SIZE_DP = 108;
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const LEGACY_DP = 48;
/** The part of the 108 dp adaptive canvas a launcher shows. */
const ADAPTIVE_VISIBLE_DP = 72;
/** toVectorDrawable's viewport: the mark's 120-unit design box. */
const VECTOR_BOX = 120;
/** The monochrome layer's colour (Android uses only its alpha). */
const MONOCHROME_FILL = '#FFFFFF';

interface AppIconImage {
  appearances?: readonly { appearance: 'luminosity'; value: 'dark' | 'tinted' }[];
  filename: string;
  idiom: 'universal';
  platform: 'ios';
  size: '1024x1024';
}

function appIconImage(filename: string, value?: 'dark' | 'tinted'): AppIconImage {
  return {
    ...(value === undefined ? {} : { appearances: [{ appearance: 'luminosity', value }] }),
    filename,
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  };
}

function appIconContents(prefix = 'AppIcon'): string {
  return xcodeJson({
    images: [
      appIconImage(`${prefix}-any.png`),
      appIconImage(`${prefix}-dark.png`, 'dark'),
      appIconImage(`${prefix}-tinted.png`, 'tinted'),
    ],
    info: { author: 'xcode', version: 1 },
  });
}

function iosAppIconEntries(): Entry[] {
  const icon = (variant: 'any' | 'dark' | 'tinted', dev: boolean): Uint8Array => {
    const svg = toSvg(markDocument(variant, IOS_ICON_PX));
    const colours = variant === 'tinted' ? RIBBON_COLOURS.tinted : RIBBON_COLOURS.colour;
    const out = dev
      ? withRibbonSvg(svg, ribbonSvg(IOS_ICON_PX, IOS_ICON_PX, CORNER_FIT, colours))
      : svg;
    return renderPng(out, IOS_ICON_PX, { opaque: variant === 'any' });
  };
  return [
    [`${APP_ICON_SET}/AppIcon-any.png`, icon('any', false)],
    [`${APP_ICON_SET}/AppIcon-dark.png`, icon('dark', false)],
    [`${APP_ICON_SET}/AppIcon-tinted.png`, icon('tinted', false)],
    [`${APP_ICON_SET}/Contents.json`, appIconContents()],
    [`${DEV_ICON_SET}/AppIcon-Dev-any.png`, icon('any', true)],
    [`${DEV_ICON_SET}/AppIcon-Dev-dark.png`, icon('dark', true)],
    [`${DEV_ICON_SET}/AppIcon-Dev-tinted.png`, icon('tinted', true)],
    [`${DEV_ICON_SET}/Contents.json`, appIconContents('AppIcon-Dev')],
  ];
}

function backgroundColourXml(): string {
  return [
    XML_HEADER,
    '<resources>',
    `  <color name="ic_launcher_background">${UI_COLORS.bg}</color>`,
    '</resources>',
    '',
  ].join('\n');
}

function adaptiveIconXml(): string {
  return [
    XML_HEADER,
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <background android:drawable="@color/ic_launcher_background"/>',
    '  <foreground android:drawable="@drawable/ic_launcher_foreground"/>',
    '  <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>',
    '</adaptive-icon>',
    '',
  ].join('\n');
}

function adaptiveIconEntries(): Entry[] {
  const layer = (variant: 'adaptiveFg' | 'monochrome'): string =>
    toVectorDrawable(markDocument(variant, ADAPTIVE_SIZE_DP), { sizeDp: ADAPTIVE_SIZE_DP });
  // Identical on purpose: API 26+ launchers apply their own mask to the same layers.
  const adaptive = adaptiveIconXml();
  // The layers' 120-unit viewport stands for 108 dp, of which launchers show the inner 72.
  const visible = (VECTOR_BOX * ADAPTIVE_VISIBLE_DP) / ADAPTIVE_SIZE_DP;
  const dev = (variant: 'adaptiveFg' | 'monochrome'): string =>
    withRibbonVector(
      layer(variant),
      VECTOR_BOX,
      visible,
      CIRCLE_FIT,
      variant === 'monochrome' ? { band: MONOCHROME_FILL, ink: null } : RIBBON_COLOURS.colour,
    );
  return [
    [`${ANDROID_RES}/values/ic_launcher_background.xml`, backgroundColourXml()],
    [`${ANDROID_RES}/drawable/ic_launcher_foreground.xml`, layer('adaptiveFg')],
    [`${ANDROID_RES}/drawable/ic_launcher_monochrome.xml`, layer('monochrome')],
    [`${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher.xml`, adaptive],
    [`${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive],
    [`${ANDROID_DEBUG_RES}/drawable/ic_launcher_foreground.xml`, dev('adaptiveFg')],
    [`${ANDROID_DEBUG_RES}/drawable/ic_launcher_monochrome.xml`, dev('monochrome')],
  ];
}

/**
 * The `any` document at px with the adaptive icon's mark size: a plain circle mask of the
 * 80 % render would clip the mark's corners. Exported for tests and the preview sheet.
 */
export function legacyRoundDocument(px: number): MarkDocument {
  const doc = markDocument('any', px);
  const { markSize } = placementFor('adaptiveFg', (px * ADAPTIVE_SIZE_DP) / ADAPTIVE_VISIBLE_DP);
  return { ...doc, palette: { ...doc.palette }, placement: { canvas: px, markSize } };
}

/** The round legacy icon: the mark on a circular ground, transparent corners. */
function roundIconSvg(px: number): string {
  const doc = legacyRoundDocument(px);
  const svg = toSvg({ ...doc, palette: { ...doc.palette, ground: null } });
  const open = /^<svg [^>]*>/.exec(svg)?.[0];
  if (open === undefined || doc.palette.ground === null) {
    throw new Error('unexpected SVG prefix: cannot insert the round ground');
  }
  const r = px / 2;
  return `${open}<circle cx="${r}" cy="${r}" r="${r}" fill="${doc.palette.ground}"/>${svg.slice(open.length)}`;
}

function legacyIconEntries(): Entry[] {
  const entries: Entry[] = DENSITIES.flatMap(({ name, scale }): Entry[] => {
    const px = LEGACY_DP * scale;
    const square = toSvg(markDocument('any', px));
    const round = roundIconSvg(px);
    const colours = RIBBON_COLOURS.colour;
    return [
      [`${ANDROID_RES}/mipmap-${name}/ic_launcher.png`, renderPng(square, px, { opaque: true })],
      [`${ANDROID_RES}/mipmap-${name}/ic_launcher_round.png`, renderPng(round, px)],
      [
        `${ANDROID_DEBUG_RES}/mipmap-${name}/ic_launcher.png`,
        renderPng(withRibbonSvg(square, ribbonSvg(px, px, CORNER_FIT, colours)), px, {
          opaque: true,
        }),
      ],
      [
        `${ANDROID_DEBUG_RES}/mipmap-${name}/ic_launcher_round.png`,
        renderPng(withRibbonSvg(round, ribbonSvg(px, px, CIRCLE_FIT, colours, true)), px),
      ],
    ];
  });
  return entries;
}

export function buildIconFiles(): FileMap {
  return new Map([...iosAppIconEntries(), ...adaptiveIconEntries(), ...legacyIconEntries()]);
}
