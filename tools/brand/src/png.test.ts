import { Resvg } from '@resvg/resvg-js';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { readPngInfo, renderPng } from './png';
import { markDocument, toSvg } from './svg';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A chunk with a zero CRC: readPngInfo never checks CRCs. */
function chunk(type: string, data: Uint8Array, declaredLength = data.length): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, declaredLength);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  return out;
}

function pngBytes(
  ihdr: { w: number; h: number; colorType: number },
  extra: readonly Uint8Array[] = [],
): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, ihdr.w);
  view.setUint32(4, ihdr.h);
  data[8] = 8;
  data[9] = ihdr.colorType;
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', data), ...extra];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const empty = new Uint8Array(0);

describe('readPngInfo', () => {
  it('reads size and colour type', () => {
    expect(readPngInfo(pngBytes({ w: 1024, h: 512, colorType: 2 }))).toEqual({
      width: 1024,
      height: 512,
      colorType: 2,
      hasAlpha: false,
    });
  });

  it('reports alpha for colour types 4 and 6', () => {
    expect(readPngInfo(pngBytes({ w: 1, h: 1, colorType: 6 })).hasAlpha).toBe(true);
    expect(readPngInfo(pngBytes({ w: 1, h: 1, colorType: 4 })).hasAlpha).toBe(true);
  });

  it('reports alpha for a tRNS chunk before the image data only', () => {
    const trns = chunk('tRNS', new Uint8Array(6));
    const idat = chunk('IDAT', new Uint8Array(4));
    expect(readPngInfo(pngBytes({ w: 1, h: 1, colorType: 2 }, [trns, idat])).hasAlpha).toBe(true);
    expect(readPngInfo(pngBytes({ w: 1, h: 1, colorType: 2 }, [idat, trns])).hasAlpha).toBe(false);
  });

  it('reads sizes as unsigned', () => {
    expect(readPngInfo(pngBytes({ w: 0x80000000, h: 1, colorType: 2 })).width).toBe(2147483648);
  });

  it('reads a Buffer slice with a byte offset', () => {
    const png = pngBytes({ w: 7, h: 9, colorType: 6 });
    const slice = Buffer.concat([Buffer.alloc(7), png]).subarray(7);
    expect(slice.byteOffset).not.toBe(0);
    expect(readPngInfo(slice)).toEqual(readPngInfo(png));
  });

  it('throws on non-PNG input', () => {
    for (const bad of [new TextEncoder().encode('<svg/>'), empty, new Uint8Array(4)]) {
      expect(() => readPngInfo(bad)).toThrow(RangeError);
    }
  });

  it('throws on a truncated or missing IHDR', () => {
    const stub = new Uint8Array([...SIGNATURE, ...new Uint8Array(10)]);
    expect(() => readPngInfo(stub)).toThrow(RangeError);
    const idatFirst = new Uint8Array([...SIGNATURE, ...chunk('IDAT', new Uint8Array(13))]);
    expect(() => readPngInfo(idatFirst)).toThrow(RangeError);
  });

  it('stops quietly at a chunk that runs past the end', () => {
    const broken = chunk('tEXt', empty, 1000).subarray(0, 8);
    expect(readPngInfo(pngBytes({ w: 1, h: 1, colorType: 2 }, [broken])).hasAlpha).toBe(false);
  });
});

describe('renderPng', () => {
  const any = toSvg(markDocument('any', 1024));
  const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

  it('renders a square of the requested width', () => {
    expect(readPngInfo(renderPng(any, 1024))).toMatchObject({ width: 1024, height: 1024 });
    expect(readPngInfo(renderPng(toSvg(markDocument('splashLight', 288)), 384))).toMatchObject({
      width: 384,
      height: 384,
    });
  });

  it('writes an RGB PNG with no alpha when opaque', () => {
    expect(readPngInfo(renderPng(any, 1024, { opaque: true }))).toMatchObject({
      colorType: 2,
      hasAlpha: false,
    });
    const small = renderPng(toSvg(markDocument('any', 512)), 512, { opaque: true });
    expect(readPngInfo(small)).toMatchObject({ width: 512, colorType: 2, hasAlpha: false });
  });

  it('keeps alpha for a transparent ground', () => {
    expect(readPngInfo(renderPng(toSvg(markDocument('dark', 1024)), 1024)).hasAlpha).toBe(true);
  });

  it('gives the same bytes for the same input', () => {
    expect(same(renderPng(any, 1024), renderPng(any, 1024))).toBe(true);
    expect(
      same(renderPng(any, 1024, { opaque: true }), renderPng(any, 1024, { opaque: true })),
    ).toBe(true);
  });

  it('paints the ground in the corner', () => {
    const pixels = new Resvg(any, { fitTo: { mode: 'width', value: 1024 } }).render().pixels;
    expect([...pixels.subarray(0, 4)]).toEqual([0x14, 0x18, 0x1f, 0xff]);
    const png = renderPng(any, 1024, { opaque: true });
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...rows.subarray(0, 4)]).toEqual([0, 0x14, 0x18, 0x1f]);
  });

  it('throws on a bad width, a missing ground or a non-square SVG', () => {
    for (const bad of [0, -1, 10.5, Number.NaN])
      expect(() => renderPng(any, bad)).toThrow(RangeError);
    expect(() => renderPng(toSvg(markDocument('dark', 1024)), 1024, { opaque: true })).toThrow(
      RangeError,
    );
    const wide = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"/>';
    expect(() => renderPng(wide, 100)).toThrow(RangeError);
  });

  describe('with a height', () => {
    const wide =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
      '<rect width="1200" height="630" fill="#1B1C19"/><circle cx="600" cy="315" r="200" fill="#ffffff"/></svg>';

    it('renders a rectangle of the requested size', () => {
      expect(readPngInfo(renderPng(wide, 1200, { heightPx: 630 }))).toMatchObject({
        width: 1200,
        height: 630,
      });
    });

    it('writes an opaque RGB rectangle', () => {
      expect(readPngInfo(renderPng(wide, 1200, { heightPx: 630, opaque: true }))).toEqual({
        width: 1200,
        height: 630,
        colorType: 2,
        hasAlpha: false,
      });
    });

    it('gives the same bytes for the same rectangle', () => {
      const opts = { heightPx: 630, opaque: true };
      expect(same(renderPng(wide, 1200, opts), renderPng(wide, 1200, opts))).toBe(true);
    });

    it('still throws without a height for a non-square SVG', () => {
      expect(() => renderPng(wide, 1200)).toThrow(RangeError);
    });

    it('throws on a bad height or a size mismatch', () => {
      for (const bad of [0, -1, 10.5, Number.NaN])
        expect(() => renderPng(wide, 1200, { heightPx: bad })).toThrow(RangeError);
      expect(() => renderPng(wide, 1200, { heightPx: 600 })).toThrow(/1200x600/);
      expect(() => renderPng(wide, 1200, { heightPx: 600 })).toThrow(RangeError);
    });
  });
});
