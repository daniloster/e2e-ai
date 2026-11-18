// @pn/brand: the Pocket Notes mark and its platform outputs.
export type {
  Bounds,
  BrandTarget,
  Density,
  Drift,
  FileMap,
  MarkDocument,
  MarkRole,
  MarkShape,
  Palette,
  Placement,
  SplashConstants,
  TargetId,
  VariantId,
} from './types';
export { BRAND_MARK, MONOCHROME_MARK, markBounds } from './mark';
export { OUTLINE_WIDTH, mix, paletteFor, toGray } from './palettes';
export { fitsCircle, placementFor } from './placement';
export { markDocument, toSvg } from './svg';
export type { PngInfo } from './png';
export { readPngInfo, renderPng } from './png';
export type { VectorOptions } from './vectorDrawable';
export { toVectorDrawable } from './vectorDrawable';
export {
  ANDROID_DEBUG_RES,
  ANDROID_RES,
  APP_BRAND,
  DENSITIES,
  IOS_APP,
  IOS_ASSETS,
  SITE_ASSET_DIR,
} from './paths';
export { SPLASH_CONSTANTS } from './splashConstants';
export { launchStoryboard } from './storyboard';
export { buildIconFiles } from './targets/icons';
export { buildSplashFiles } from './targets/splash';
export { buildSiteFiles } from './targets/site';
export { buildUiFiles } from './targets/ui';
export { DEFAULT_TARGET_IDS, TARGET_IDS, TARGETS } from './targets';
export { checkTarget, writeFiles } from './fsio';
