// The generator's targets. Strategy: an exhaustive registry of interchangeable "build a file map"
// algorithms; callers index it and never branch on a target. Builds run only when a caller invokes
// them (each renders a dozen PNGs).
import type { BrandTarget, TargetId } from '../types';
import { buildIconFiles } from './icons';
import { siteTarget } from './site';
import { buildSplashFiles } from './splash';
import { uiTarget } from './ui';

export const TARGETS: Readonly<Record<TargetId, BrandTarget>> = Object.freeze({
  icons: Object.freeze({ id: 'icons', build: buildIconFiles }),
  splash: Object.freeze({ id: 'splash', build: buildSplashFiles }),
  site: siteTarget,
  ui: uiTarget,
});

/** Registry order: the order every caller builds, writes and reports in. */
export const TARGET_IDS: readonly TargetId[] = Object.freeze([
  'icons',
  'splash',
  'site',
  'ui',
]);

/** What runs without --targets: every target. */
export const DEFAULT_TARGET_IDS: readonly TargetId[] = TARGET_IDS;
