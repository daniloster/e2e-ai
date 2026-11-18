// Versioned share-link codec: `/s#<payload>` carries a board as base64url bytes.
//
// Layout (version 1):
//   byte 0 version · byte 1 flags (none defined; must be 0) · bytes 2-3 blocks, big-endian
//   (MIN_BLOCKS..MAX_BLOCKS).
//
// Once released, the layout changes only additively behind the version byte (a new version or a
// new flag bit); an existing field is never reinterpreted. Decoding never throws: a payload from a
// newer build answers `unsupportedVersion` so the app can ask for an update.
import { fromBase64Url, toBase64Url } from './encoding';
import { isValidBlocks } from './state';

export const CODEC_VERSION = 1;
const LENGTH = 4;

export interface SharePayload {
  readonly blocks: number;
}

export type ShareDecodeError = 'unsupportedVersion' | 'malformed';

export type ShareDecodeResult =
  | { readonly ok: true; readonly blocks: number }
  | { readonly ok: false; readonly error: ShareDecodeError };

/** The base64url payload of a share link. Throws a RangeError on an invalid block count. */
export function encodeShare({ blocks }: SharePayload): string {
  if (!isValidBlocks(blocks)) throw new RangeError('blocks out of range');
  return toBase64Url(Uint8Array.from([CODEC_VERSION, 0, blocks >> 8, blocks & 0xff]));
}

export function decodeShare(text: string): ShareDecodeResult {
  const bytes = typeof text === 'string' ? fromBase64Url(text) : null;
  if (bytes === null || bytes.length === 0) return { ok: false, error: 'malformed' };
  if (bytes[0] !== CODEC_VERSION) return { ok: false, error: 'unsupportedVersion' };
  if (bytes.length !== LENGTH || bytes[1] !== 0) return { ok: false, error: 'malformed' };
  const blocks = ((bytes[2] as number) << 8) | (bytes[3] as number);
  if (!isValidBlocks(blocks)) return { ok: false, error: 'malformed' };
  return { ok: true, blocks };
}
