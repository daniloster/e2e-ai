// PNG helpers for the brand generator. readPngInfo reads the header and alpha only; it
// imports nothing so the app's Jest tests can copy it verbatim. renderPng rasterises SVG
// with resvg, which renders the same bytes on every OS (no system fonts, no GPU).
import { Resvg } from '@resvg/resvg-js';
import { crc32, deflateSync } from 'node:zlib';

export interface PngInfo {
  width: number;
  height: number;
  /** PNG IHDR colour type: 2 = RGB, 6 = RGBA, etc. */
  colorType: number;
  /** colorType 4 or 6, or a tRNS chunk present. */
  hasAlpha: boolean;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads IHDR and scans for tRNS; throws on a non-PNG signature. */
export function readPngInfo(bytes: Uint8Array): PngInfo {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new RangeError('not a PNG: bad signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 33 || type(12) !== 'IHDR') throw new RangeError('not a PNG: no IHDR');
  const colorType = bytes[25] ?? 0;
  let hasAlpha = colorType === 4 || colorType === 6;
  for (let at = 33; at + 8 <= bytes.length;) {
    const chunk = type(at + 4);
    if (chunk === 'IDAT' || chunk === 'IEND') break;
    if (chunk === 'tRNS') hasAlpha = true;
    at += 12 + view.getUint32(at);
  }
  return { width: view.getUint32(16), height: view.getUint32(20), colorType, hasAlpha };
}

/** The ground of a mark SVG: the fill of the rect right after the opening tag. */
const GROUND_RECT = /^<svg [^>]*><rect [^>]*fill="(#[0-9a-fA-F]{6})"/;

function groundOf(svg: string): string {
  const ground = GROUND_RECT.exec(svg)?.[1];
  if (ground === undefined) throw new RangeError('opaque render needs a ground');
  return ground;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit RGB PNG (colour type 2) from RGBA pixels, alpha dropped. Deterministic. */
function encodeRgbPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      raw.set(rgba.subarray(from, from + 3), row + 1 + x * 3);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(SIGNATURE),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Renders SVG text to a PNG exactly `widthPx` wide and `opts.heightPx` (default `widthPx`) tall;
 * throws `RangeError` when the SVG's aspect ratio gives another size.
 * `opaque` flattens onto the SVG's ground and drops the alpha channel (colour type 2).
 */
export function renderPng(
  svg: string,
  widthPx: number,
  opts?: { opaque?: boolean; heightPx?: number },
): Uint8Array {
  if (!Number.isInteger(widthPx) || widthPx <= 0) {
    throw new RangeError(`widthPx must be a positive integer, got ${widthPx}`);
  }
  const heightPx = opts?.heightPx;
  if (heightPx !== undefined && (!Number.isInteger(heightPx) || heightPx <= 0)) {
    throw new RangeError(`heightPx must be a positive integer, got ${heightPx}`);
  }
  const opaque = opts?.opaque === true;
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx },
    font: { loadSystemFonts: false },
    ...(opaque ? { background: groundOf(svg) } : {}),
  }).render();
  if (heightPx === undefined) {
    if (image.width !== widthPx || image.height !== widthPx) {
      throw new RangeError(`expected a ${widthPx} px square, got ${image.width}x${image.height}`);
    }
  } else if (image.width !== widthPx || image.height !== heightPx) {
    throw new RangeError(`expected ${widthPx}x${heightPx} px, got ${image.width}x${image.height}`);
  }
  return opaque ? encodeRgbPng(image.pixels, image.width, image.height) : image.asPng();
}
