import { describe, expect, it } from 'vitest';
import { CODEC_VERSION, decodeShare, encodeShare } from './codec';
import { toBase64Url } from './encoding';
import { MAX_BLOCKS } from './types';

const raw = (...bytes: number[]) => toBase64Url(Uint8Array.from(bytes));

describe('encodeShare', () => {
  it('writes the version, the flags and the blocks (frozen v1 fixtures)', () => {
    expect(CODEC_VERSION).toBe(1);
    expect(encodeShare({ blocks: 12 })).toBe('AQAADA');
    expect(encodeShare({ blocks: MAX_BLOCKS })).toBe('AQAD5w');
  });

  it.each([0, MAX_BLOCKS + 1, 2.5])('rejects %d blocks', (blocks) => {
    expect(() => encodeShare({ blocks })).toThrow(RangeError);
  });
});

describe('decodeShare', () => {
  it('reads a v1 payload', () => {
    expect(decodeShare('AQAADA')).toEqual({ ok: true, blocks: 12 });
  });

  it('answers unsupportedVersion for another version byte', () => {
    expect(decodeShare(raw(2, 0, 0, 12))).toEqual({ ok: false, error: 'unsupportedVersion' });
    expect(decodeShare(raw(0))).toEqual({ ok: false, error: 'unsupportedVersion' });
  });

  it.each([
    ['empty', ''],
    ['bad base64', 'A+AA'],
    ['truncated', raw(1, 0, 0)],
    ['trailing data', raw(1, 0, 0, 12, 0)],
    ['unknown flag', raw(1, 1, 0, 12)],
    ['zero blocks', raw(1, 0, 0, 0)],
    ['too many blocks', raw(1, 0, 0x03, 0xe8)],
  ])('answers malformed for %s', (_, text) => {
    expect(decodeShare(text)).toEqual({ ok: false, error: 'malformed' });
  });

  it('never throws on a non-string', () => {
    expect(decodeShare(42 as unknown as string)).toEqual({ ok: false, error: 'malformed' });
  });
});
