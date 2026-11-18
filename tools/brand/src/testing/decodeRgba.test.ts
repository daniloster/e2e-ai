import { describe, expect, it } from 'vitest';

import { renderPng } from '../png';
import { decodeRgba } from './decodeRgba';

const HALF_RED =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><rect x="2" width="2" height="4" fill="#ff0000"/></svg>';

describe('decodeRgba', () => {
  it('reads a resvg RGBA render pixel for pixel', () => {
    const image = decodeRgba(renderPng(HALF_RED, 4));
    expect(image.width).toBe(4);
    expect(image.data[3]).toBe(0);
    expect([...image.data.subarray(15 * 4, 16 * 4)]).toEqual([0xff, 0, 0, 0xff]);
  });

  it('rejects anything but 8-bit RGBA', () => {
    const opaque =
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><rect width="4" height="4" fill="#52309a"/></svg>';
    expect(() => decodeRgba(renderPng(opaque, 4, { opaque: true }))).toThrow(Error);
  });
});
