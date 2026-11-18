// Share links: `pocketnotes://s#<payload>` (custom scheme) and `https://pocketnotes.app/s#<payload>`
// (Universal Links / App Links, also under /es/ and /pt-br/). Pure: parses a URL the OS hands the app
// and decodes it with @pn/core's versioned codec. The payload sits in the fragment, so it never
// reaches a server log.
import { decodeShare, encodeShare } from '@pn/core';

export const SITE_ORIGIN = 'https://pocketnotes.app';
export const URL_SCHEME = 'pocketnotes';

const SCHEME_LINK = /^pocketnotes:\/\/\/?s\/?(?:\?[^#]*)?(?:#(.*))?$/i;
const WEB_LINK =
  /^https:\/\/(?:www\.)?pocketnotes\.app(?:\/(?:es|pt-br))?\/s\/?(?:\?[^#]*)?(?:#(.*))?$/i;
const PAYLOAD = /^[A-Za-z0-9_-]+$/;

/** `invalidLink`: damaged or incomplete; `unsupportedLink`: made by a newer version of the app. */
export type LinkError = 'invalidLink' | 'unsupportedLink';

export type LinkResult =
  | { ok: true; blocks: number; payload: string }
  | { ok: false; error: LinkError };

/** null when the URL is not a share link at all (it is ignored); otherwise the board or the error. */
export function parseShareLink(url: string): LinkResult | null {
  const trimmed = url.trim();
  const match = SCHEME_LINK.exec(trimmed) ?? WEB_LINK.exec(trimmed);
  if (!match) return null;
  let payload = match[1] ?? '';
  try {
    payload = decodeURIComponent(payload).trim();
  } catch {
    return { ok: false, error: 'invalidLink' };
  }
  if (!PAYLOAD.test(payload)) return { ok: false, error: 'invalidLink' };
  const decoded = decodeShare(payload);
  if (!decoded.ok)
    return {
      ok: false,
      error:
        decoded.error === 'unsupportedVersion'
          ? 'unsupportedLink'
          : 'invalidLink',
    };
  return { ok: true, blocks: decoded.blocks, payload };
}

/** The https share link for a board of `blocks` blocks. */
export function shareLink(blocks: number): string {
  return `${SITE_ORIGIN}/s#${encodeShare({ blocks })}`;
}
