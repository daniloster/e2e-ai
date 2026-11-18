// @vitest-environment node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SITE_PAGES } from '../src/site/pages';
import { APP_ENTRIES, HTML_ENTRIES, SITE_TEMPLATE_KEYS, rollupInput } from './htmlEntries';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('HTML_ENTRIES', () => {
  it('has one template per registered site page, and each exists', () => {
    const templates = SITE_PAGES.map((page) => page.template).sort();
    expect(Object.values(HTML_ENTRIES).sort()).toEqual(templates);
    for (const file of Object.values(HTML_ENTRIES)) expect(existsSync(`${ROOT}${file}`)).toBe(true);
  });

  it('serves every entry as a site template', () => {
    expect([...SITE_TEMPLATE_KEYS].sort()).toEqual(Object.keys(HTML_ENTRIES).sort());
  });

  it('has no TV page', () => {
    expect(Object.keys(HTML_ENTRIES)).not.toContain('play');
  });
});

describe('rollupInput', () => {
  it('resolves every entry under the root', () => {
    const input = rollupInput('/root');
    expect(input.index).toBe('/root/index.html');
    expect(input.s).toBe('/root/s.html');
    expect(input.app).toBe('/root/app.html');
    expect(Object.keys(input)).toEqual([...Object.keys(HTML_ENTRIES), ...Object.keys(APP_ENTRIES)]);
  });
});
