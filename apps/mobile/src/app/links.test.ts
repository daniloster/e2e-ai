import { encodeShare } from '@pn/core';

import { parseShareLink, shareLink } from './links';

const payload = encodeShare({ blocks: 42 });

describe('parseShareLink', () => {
  it.each([
    `pocketnotes://s#${payload}`,
    `pocketnotes:///s/#${payload}`,
    `https://pocketnotes.app/s#${payload}`,
    `https://www.pocketnotes.app/es/s#${payload}`,
    `https://pocketnotes.app/pt-br/s/?utm=x#${payload}`,
  ])('decodes %s', url => {
    expect(parseShareLink(url)).toEqual({ ok: true, blocks: 42, payload });
  });

  it('decodes the scripts/deep-link.sh sample AQAAGA in both forms', () => {
    for (const url of [
      'pocketnotes://s#AQAAGA',
      'https://pocketnotes.app/s#AQAAGA',
      'https://www.pocketnotes.app/pt-br/s#AQAAGA',
    ])
      expect(parseShareLink(url)).toEqual({
        ok: true,
        blocks: 24,
        payload: 'AQAAGA',
      });
  });

  it.each([
    'https://pocketnotes.app/support',
    'https://example.com/s#AQAAKg',
    'pocketnotes://dev/home',
    'not a url',
  ])('ignores %s', url => {
    expect(parseShareLink(url)).toBeNull();
  });

  it('reports a damaged link', () => {
    expect(parseShareLink('pocketnotes://s#')).toEqual({
      ok: false,
      error: 'invalidLink',
    });
    expect(parseShareLink('pocketnotes://s#%E0%A4%A')).toEqual({
      ok: false,
      error: 'invalidLink',
    });
    expect(parseShareLink('pocketnotes://s#AQ')).toEqual({
      ok: false,
      error: 'invalidLink',
    });
  });

  it('asks for an update for a link from a newer codec version', () => {
    // Version byte 0x7f.
    expect(parseShareLink('pocketnotes://s#fwAAKg')).toEqual({
      ok: false,
      error: 'unsupportedLink',
    });
  });
});

describe('shareLink', () => {
  it('round-trips through parseShareLink', () => {
    const link = shareLink(7);
    expect(link.startsWith('https://pocketnotes.app/s#')).toBe(true);
    expect(parseShareLink(link)).toMatchObject({ ok: true, blocks: 7 });
  });
});
