// Test-only PNG decoder: 8-bit RGBA, non-interlaced. No production file imports it.
import { inflateSync } from 'node:zlib';

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodeRgba(png: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const [width, height] = [view.getUint32(16), view.getUint32(20)];
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) {
    throw new Error('decodeRgba reads 8-bit RGBA, non-interlaced PNGs only');
  }
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const length = view.getUint32(at);
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === 'IDAT') {
      idat.push(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= 4 ? (data[y * stride + x - 4] ?? 0) : 0;
      const b = y > 0 ? (data[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= 4 && y > 0 ? (data[(y - 1) * stride + x - 4] ?? 0) : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      data[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, data };
}
