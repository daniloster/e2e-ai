import { UI_COLORS } from '@pn/design-tokens';
import { describe, expect, it } from 'vitest';

import { assertWellFormedXml } from './testing/xmlWellFormed';
import { UI_ART_NAMES, UI_ART_PALETTE, uiArtSources } from './uiArt';

describe('uiArtSources', () => {
  const sources = uiArtSources();

  it('has the IconButton and ScreenHeader glyphs, in order, frozen', () => {
    expect(UI_ART_NAMES).toEqual([
      'back',
      'sync',
      'share',
      'close',
      'check',
      'chevronDown',
      'settings',
      'play',
    ]);
    expect(sources.map((s) => s.name)).toEqual(UI_ART_NAMES);
    expect(Object.isFrozen(sources)).toBe(true);
    expect(Object.isFrozen(sources[0])).toBe(true);
  });

  it('draws 24 pt single-colour glyphs, well-formed, with no text or images', () => {
    for (const s of sources) {
      expect([s.widthPt, s.heightPt, s.kind]).toEqual([24, 24, 'glyph']);
      assertWellFormedXml(s.svg);
      expect(s.svg).toContain('viewBox="0 0 24 24"');
      for (const banned of ['<text', '<image', '<script', 'href'])
        expect(s.svg).not.toContain(banned);
    }
  });

  it('uses only token colours', () => {
    expect(UI_ART_PALETTE).toEqual([UI_COLORS.ink]);
    for (const s of sources) {
      for (const [, colour] of s.svg.matchAll(/(?:fill|stroke)="(#[^"]+)"/g)) {
        expect(UI_ART_PALETTE).toContain(colour);
      }
    }
  });

  it('is deterministic', () => {
    expect(uiArtSources()).toEqual(sources);
  });
});
