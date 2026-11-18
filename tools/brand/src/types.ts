// The brand mark's data model: shapes in a 120x120 design box, one palette and one placement per
// variant, composed into a MarkDocument that the renderers serialise.

/** Every colourable part of the mark. */
export type MarkRole = 'table' | 'facetLight' | 'facetMid' | 'facetDark' | 'sparkle';

export interface MarkShape {
  role: MarkRole;
  /** SVG path data in the mark's 120x120 design box. */
  d: string;
  /** Even-odd filling cuts overlapping sub-paths out as gaps (the single-colour layer). */
  fillRule?: 'evenodd';
}

export type VariantId =
  | 'any' // iOS default + legacy Android: opaque ground, full colour
  | 'dark' // iOS dark: transparent ground, dark-mode colours
  | 'tinted' // iOS tinted: grayscale on transparent
  | 'monochrome' // Android themed: one opaque colour, gaps as transparency
  | 'adaptiveFg' // Android adaptive foreground: full colour, no ground, safe-zone scale
  | 'splashLight' // splash logo, light appearance
  | 'splashDark'; // splash logo, dark appearance

export interface Palette {
  /** null = transparent. */
  ground: string | null;
  fills: Record<MarkRole, string>;
  /** null = no outline. */
  outline: string | null;
  /** In design-box units. */
  outlineWidth: number;
}

export interface Placement {
  /** Output square side, in the output's own units (px or dp). */
  canvas: number;
  /** Side of the 120-unit design box once scaled. */
  markSize: number;
}

export interface MarkDocument {
  variant: VariantId;
  palette: Palette;
  placement: Placement;
  shapes: readonly MarkShape[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Repo-relative POSIX path -> file contents. Insertion order is the write order. */
export type FileMap = ReadonlyMap<string, Uint8Array | string>;

export interface Density {
  name: 'mdpi' | 'hdpi' | 'xhdpi' | 'xxhdpi' | 'xxxhdpi';
  scale: 1 | 1.5 | 2 | 3 | 4;
}

export interface SplashConstants {
  logoWidthDp: 128;
  background: { light: string; dark: string };
}

export type TargetId = 'icons' | 'splash' | 'site' | 'ui';

export interface BrandTarget {
  id: TargetId;
  /** `root` is the repository root; only targets with committed inputs (store) read it. */
  build(root: string): FileMap;
}

export interface Drift {
  /** Owned path absent on disk. */
  missing: string[];
  /** Present but different bytes. */
  changed: string[];
}
