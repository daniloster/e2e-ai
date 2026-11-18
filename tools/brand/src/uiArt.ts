// The app's UI art SVG sources: 24 pt single-colour glyphs (ink, for Image tintColor) used by
// IconButton and ScreenHeader. Colours come from @pn/design-tokens only. No SVG carries text:
// resvg loads no fonts. Add an entry to GLYPHS and UI_ART_NAMES, run `npm run brand`, commit.
import { UI_COLORS } from '@pn/design-tokens';

export type UiArtName =
  'back' | 'sync' | 'share' | 'close' | 'check' | 'chevronDown' | 'settings' | 'play';

export interface UiArtSource {
  name: UiArtName;
  /** Size in points; the PNG is widthPt*scale x heightPt*scale px. */
  widthPt: number;
  heightPt: number;
  /** 'glyph': one colour (UI_COLORS.ink), meant for Image tintColor. 'art': baked colours. */
  kind: 'glyph' | 'art';
  svg: string;
}

/** Locale- and platform-independent numbers. */
function num(n: number): string {
  return Number(n.toFixed(4)).toString();
}

/** `<svg xmlns=… width=w height=h viewBox="0 0 w h">body</svg>`. */
function svgDoc(widthPt: number, heightPt: number, body: string): string {
  const w = num(widthPt);
  const h = num(heightPt);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `${body}</svg>`
  );
}

/** Eight gear teeth as short strokes from radius 7.5 to 10 round (12, 12). */
function gearTeeth(): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    parts.push(
      `M${num(12 + c * 7.5)} ${num(12 + s * 7.5)}L${num(12 + c * 10)} ${num(12 + s * 10)}`,
    );
  }
  return parts.join('');
}

/** Glyph path data (24-unit box), stroke width and whether the outline is also filled. */
const GLYPHS: Readonly<Record<UiArtName, { d: string; width: number; filled?: boolean }>> =
  Object.freeze({
    back: { d: 'M15 5l-7 7 7 7', width: 2.4 },
    sync: {
      d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
      width: 2.2,
    },
    share: { d: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6', width: 2 },
    close: { d: 'M6 6l12 12M18 6L6 18', width: 2.4 },
    check: { d: 'M5 12.5l4.5 4.5L19 7.5', width: 2.4 },
    chevronDown: { d: 'M6 9l6 6 6-6', width: 2 },
    settings: { d: `M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z${gearTeeth()}`, width: 2.2 },
    play: { d: 'M8 5.5v13l10.5-6.5z', width: 2, filled: true },
  });

/** 24 x 24 single-colour glyph in UI_COLORS.ink, for Image tintColor. */
function glyphSvg(name: UiArtName): string {
  const { d, width, filled } = GLYPHS[name];
  return svgDoc(
    24,
    24,
    `<path d="${d}" fill="${filled === true ? UI_COLORS.ink : 'none'}" stroke="${UI_COLORS.ink}" ` +
      `stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
}

/** Write order. */
export const UI_ART_NAMES: readonly UiArtName[] = Object.freeze([
  'back',
  'sync',
  'share',
  'close',
  'check',
  'chevronDown',
  'settings',
  'play',
]);

function sourceOf(name: UiArtName): UiArtSource {
  return Object.freeze({ name, widthPt: 24, heightPt: 24, kind: 'glyph', svg: glyphSvg(name) });
}

/** One frozen source per name, in UI_ART_NAMES order. Pure string building, renders nothing. */
export function uiArtSources(): readonly UiArtSource[] {
  return Object.freeze(UI_ART_NAMES.map(sourceOf));
}

/** Every colour an SVG source may use. */
export const UI_ART_PALETTE: readonly string[] = Object.freeze([UI_COLORS.ink]);
