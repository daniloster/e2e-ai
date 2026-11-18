// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveFile } from './serve.mjs';

const KEY_PATH = fileURLToPath(new URL('./key.pem', import.meta.url));
const keyExistedBefore = existsSync(KEY_PATH);
const dirs = [];

function fixture({ with404 = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'serve-'));
  dirs.push(root);
  writeFileSync(join(root, 'index.html'), 'index');
  writeFileSync(join(root, 'faq.html'), 'faq');
  if (with404) writeFileSync(join(root, '404.html'), 'missing');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'x.js'), 'x');
  mkdirSync(join(root, 'empty'));
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveFile', () => {
  it('applies the 200 splat rewrites of _redirects first, as Cloudflare does', async () => {
    const root = fixture();
    writeFileSync(join(root, 'shell.html'), 'shell');
    writeFileSync(join(root, '_redirects'), '# comment\n/old /new 301\n/items/* /shell 200\n');
    expect(await resolveFile(root, '/items/abc%2342')).toEqual({
      status: 200,
      file: join(root, 'shell.html'),
    });
    // The bare prefix matches nothing, and other rule shapes are ignored.
    expect((await resolveFile(root, '/items/')).status).toBe(404);
    expect((await resolveFile(root, '/old')).status).toBe(404);
  });

  it('serves /<name> from <name>.html, / from index.html and existing files as is', async () => {
    const root = fixture();
    expect(await resolveFile(root, '/faq')).toEqual({
      status: 200,
      file: join(root, 'faq.html'),
    });
    expect(await resolveFile(root, '/')).toEqual({ status: 200, file: join(root, 'index.html') });
    expect(await resolveFile(root, '/assets/x.js')).toEqual({
      status: 200,
      file: join(root, 'assets', 'x.js'),
    });
    expect(await resolveFile(root, '/faq.html')).toEqual({
      status: 200,
      file: join(root, 'faq.html'),
    });
  });

  it('answers 404 with 404.html for unknown paths, never index.html', async () => {
    const root = fixture();
    const missing = { status: 404, file: join(root, '404.html') };
    expect(await resolveFile(root, '/does-not-exist')).toEqual(missing);
    expect(await resolveFile(root, '/assets/missing.js')).toEqual(missing);
    expect(await resolveFile(root, '/faq/x')).toEqual(missing);
  });

  it('answers 404 with no file when 404.html is absent', async () => {
    const root = fixture({ with404: false });
    expect(await resolveFile(root, '/does-not-exist')).toEqual({ status: 404, file: null });
    expect(await resolveFile(root, '/assets/missing.js')).toEqual({ status: 404, file: null });
  });

  it('redirects /<name>/ to /<name> when <name>.html exists', async () => {
    const root = fixture();
    expect(await resolveFile(root, '/faq/')).toEqual({ status: 307, location: '/faq' });
  });

  it('answers 404 for a directory without index.html', async () => {
    const root = fixture();
    const missing = { status: 404, file: join(root, '404.html') };
    expect(await resolveFile(root, '/empty/')).toEqual(missing);
    expect(await resolveFile(root, '/empty')).toEqual(missing);
  });

  it('serves a directory index and prefers <name>.html over it', async () => {
    const root = fixture();
    mkdirSync(join(root, 'faq'));
    writeFileSync(join(root, 'faq', 'index.html'), 'dir');
    expect(await resolveFile(root, '/faq')).toEqual({
      status: 200,
      file: join(root, 'faq.html'),
    });
    expect(await resolveFile(root, '/faq/')).toEqual({
      status: 200,
      file: join(root, 'faq', 'index.html'),
    });
  });

  it('never resolves outside root and survives malformed encoding', async () => {
    const root = fixture();
    for (const path of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc']) {
      const result = await resolveFile(root, path);
      expect([403, 404]).toContain(result.status);
      if ('file' in result && result.file) expect(result.file.startsWith(root)).toBe(true);
    }
    expect(await resolveFile(root, '/%E0%A4%A')).toEqual({
      status: 404,
      file: join(root, '404.html'),
    });
  });

  it('starts no server and generates no certificate on import', () => {
    expect(existsSync(KEY_PATH)).toBe(keyExistedBefore);
  });
});
