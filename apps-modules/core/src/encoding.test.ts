import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './encoding';

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('base64url', () => {
  it('encodes without padding using the URL alphabet', () => {
    expect(toBase64Url(text(''))).toBe('');
    expect(toBase64Url(text('f'))).toBe('Zg');
    expect(toBase64Url(text('fo'))).toBe('Zm8');
    expect(toBase64Url(text('foo'))).toBe('Zm9v');
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8');
  });

  it('decodes and rejects foreign characters, impossible lengths and stray bits', () => {
    expect(fromBase64Url('Zm9v')).toEqual(text('foo'));
    expect(fromBase64Url('-_8')).toEqual(Uint8Array.from([0xfb, 0xff]));
    expect(fromBase64Url('')).toEqual(new Uint8Array(0));
    expect(fromBase64Url('Zm9vY')).toBeNull();
    expect(fromBase64Url('Zm+v')).toBeNull();
    expect(fromBase64Url('Zh')).toBeNull();
  });
});
