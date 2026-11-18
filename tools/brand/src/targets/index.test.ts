import { describe, expect, it } from 'vitest';

import { buildIconFiles } from './icons';
import { DEFAULT_TARGET_IDS, TARGET_IDS, TARGETS } from './index';
import { siteTarget } from './site';
import { buildSplashFiles } from './splash';
import { uiTarget } from './ui';

describe('TARGETS', () => {
  it('maps every id to its own target, in registry order', () => {
    for (const id of TARGET_IDS) expect(TARGETS[id].id).toBe(id);
    expect(TARGET_IDS).toEqual(Object.keys(TARGETS));
    expect(TARGET_IDS).toEqual(['icons', 'splash', 'site', 'ui']);
  });

  it('uses the target builders', () => {
    expect(TARGETS.icons.build).toBe(buildIconFiles);
    expect(TARGETS.splash.build).toBe(buildSplashFiles);
    expect(TARGETS.site).toBe(siteTarget);
    expect(TARGETS.ui).toBe(uiTarget);
  });

  it('runs every target by default', () => {
    expect(DEFAULT_TARGET_IDS).toEqual(['icons', 'splash', 'site', 'ui']);
  });

  it('is frozen', () => {
    for (const value of [TARGETS, TARGET_IDS, DEFAULT_TARGET_IDS, ...Object.values(TARGETS)]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
