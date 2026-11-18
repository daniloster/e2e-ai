// base64url without padding: the text form of every share link payload (codec.ts).

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64[(acc >> bits) & 63];
    }
  }
  if (bits > 0) out += B64[(acc << (6 - bits)) & 63];
  return out;
}

/** Decodes unpadded base64url; null on a foreign character, an impossible length or stray bits. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of text) {
    const value = B64.indexOf(ch);
    if (value < 0) return null;
    acc = ((acc << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  // Leftover bits must be zero so every byte string has exactly one text form.
  if ((acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}
