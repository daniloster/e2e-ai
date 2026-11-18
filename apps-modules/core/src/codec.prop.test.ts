import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare } from './codec';
import { toBase64Url } from './encoding';
import { blocksArb } from './testing/fixtures';

describe('share codec (properties)', () => {
  it('round-trips every valid board', () => {
    fc.assert(
      fc.property(blocksArb, (blocks) => {
        expect(decodeShare(encodeShare({ blocks }))).toEqual({ ok: true, blocks });
      }),
      { numRuns: 500 },
    );
  });

  it('never throws, and whatever decodes re-encodes to the same text', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 8 }), (bytes) => {
        const text = toBase64Url(bytes);
        const decoded = decodeShare(text);
        if (decoded.ok) expect(encodeShare({ blocks: decoded.blocks })).toBe(text);
      }),
      { numRuns: 2000 },
    );
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => decodeShare(text)).not.toThrow();
      }),
    );
  });
});
