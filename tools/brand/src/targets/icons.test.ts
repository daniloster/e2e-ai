import { UI_COLORS } from '@pn/design-tokens';
import { beforeAll, describe, expect, it } from 'vitest';

import { readPngInfo } from '../png';
import { assertWellFormedXml } from '../testing/xmlWellFormed';
import type { FileMap } from '../types';
import { buildIconFiles } from './icons';

const IOS = 'apps/mobile/ios/PocketNotes/Images.xcassets';
const RES = 'apps/mobile/android/app/src/main/res';
const DEBUG = 'apps/mobile/android/app/src/debug/res';
const DENSITY_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 } as const;

describe('buildIconFiles', () => {
  let files: FileMap;
  beforeAll(() => {
    files = buildIconFiles();
  }, 120_000);

  const png = (path: string): Uint8Array => {
    const value = files.get(path);
    if (!(value instanceof Uint8Array)) throw new Error(`no PNG at ${path}`);
    return value;
  };
  const text = (path: string): string => {
    const value = files.get(path);
    if (typeof value !== 'string') throw new Error(`no text at ${path}`);
    return value;
  };

  it('writes 35 files: iOS sets, adaptive layers, legacy PNGs, debug overrides', () => {
    expect(files.size).toBe(35);
    expect([...files.keys()].some((k) => k.includes('play-icon'))).toBe(false);
  });

  it('renders the iOS icons at 1024 px: Any opaque, Dark and Tinted transparent', () => {
    for (const set of ['AppIcon', 'AppIcon-Dev']) {
      const at = (v: string): string => `${IOS}/${set}.appiconset/${set}-${v}.png`;
      expect(readPngInfo(png(at('any')))).toMatchObject({ width: 1024, hasAlpha: false });
      expect(readPngInfo(png(at('dark')))).toMatchObject({ width: 1024, hasAlpha: true });
      expect(readPngInfo(png(at('tinted')))).toMatchObject({ width: 1024, hasAlpha: true });
      const contents = JSON.parse(text(`${IOS}/${set}.appiconset/Contents.json`));
      expect(contents.images.map((i: { filename: string }) => i.filename)).toEqual([
        `${set}-any.png`,
        `${set}-dark.png`,
        `${set}-tinted.png`,
      ]);
    }
    expect(png(`${IOS}/AppIcon.appiconset/AppIcon-any.png`)).not.toEqual(
      png(`${IOS}/AppIcon-Dev.appiconset/AppIcon-Dev-any.png`),
    );
  });

  it('writes the adaptive icon with a monochrome layer and the ground colour', () => {
    const adaptive = text(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`);
    assertWellFormedXml(adaptive);
    expect(adaptive).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome"/>');
    expect(text(`${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`)).toBe(adaptive);
    expect(text(`${RES}/values/ic_launcher_background.xml`)).toContain(
      `<color name="ic_launcher_background">${UI_COLORS.bg}</color>`,
    );
    for (const dir of [RES, DEBUG]) {
      for (const layer of ['foreground', 'monochrome']) {
        assertWellFormedXml(text(`${dir}/drawable/ic_launcher_${layer}.xml`));
      }
    }
    expect(text(`${DEBUG}/drawable/ic_launcher_foreground.xml`)).toContain(UI_COLORS.danger);
  });

  it('renders the legacy launcher PNGs per density, square opaque and round transparent', () => {
    for (const [name, px] of Object.entries(DENSITY_PX)) {
      for (const dir of [RES, DEBUG]) {
        expect(readPngInfo(png(`${dir}/mipmap-${name}/ic_launcher.png`))).toMatchObject({
          width: px,
          hasAlpha: false,
        });
        expect(readPngInfo(png(`${dir}/mipmap-${name}/ic_launcher_round.png`))).toMatchObject({
          width: px,
          hasAlpha: true,
        });
      }
    }
  });

  it('gives the same bytes on every build', { timeout: 120_000 }, () => {
    const again = buildIconFiles();
    for (const [path, value] of files) expect(again.get(path), path).toEqual(value);
  });
});
