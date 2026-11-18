import { UI_COLORS } from '@pn/design-tokens';
import { describe, expect, it } from 'vitest';

import { launchStoryboard } from './storyboard';
import { assertWellFormedXml } from './testing/xmlWellFormed';

const xml = launchStoryboard();

describe('launchStoryboard', () => {
  it('is well-formed, deterministic and a launch screen', () => {
    assertWellFormedXml(xml);
    expect(launchStoryboard()).toBe(xml);
    expect(xml).toContain('launchScreen="YES"');
    expect(xml.endsWith('</document>\n')).toBe(true);
  });

  it('shows only the named background and the centred 128 pt logo', () => {
    expect(xml).toContain('<color key="backgroundColor" name="BootSplashBackground"/>');
    expect(xml.match(/<imageView /g)).toHaveLength(1);
    expect(xml).toContain('image="BootSplashLogo"');
    expect(xml).toContain('<constraint firstAttribute="width" constant="128" id="Lgo-Wd-001"/>');
    expect(xml).toContain('<constraint firstAttribute="height" constant="128" id="Lgo-Ht-001"/>');
    expect(xml).toMatch(
      /firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX"/,
    );
    expect(xml).toMatch(
      /firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY"/,
    );
    expect(xml).toContain('<rect key="frame" x="123.5" y="269.5" width="128" height="128"/>');
    const [red, green, blue] = [1, 3, 5].map(
      (i) => parseInt(UI_COLORS.bg.slice(i, i + 2), 16) / 255,
    );
    expect(xml).toContain(
      `<color red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>`,
    );
  });

  it('has no labels or text', () => {
    expect(xml).not.toContain('<label');
    expect(xml).not.toContain('text=');
  });

  it('only references ids it declares', () => {
    const ids = new Set([...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, ref] of xml.matchAll(/(?:firstItem|secondItem)="([^"]+)"/g)) {
      expect(ids).toContain(ref);
    }
  });
});
