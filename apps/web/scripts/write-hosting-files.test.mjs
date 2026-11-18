// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ASSETS_IGNORE,
  CATCH_ALL_FORBIDDEN_HEADERS,
  CATCH_ALL_SOURCES,
  HostingFilesError,
  formatHeaders,
  toCloudflarePattern,
  toHeaderRules,
  writeHostingFiles,
} from './write-hosting-files.mjs';

const SCRIPT = fileURLToPath(new URL('./write-hosting-files.mjs', import.meta.url));
const FIREBASE_JSON = fileURLToPath(new URL('../firebase.json', import.meta.url));
const CSP_VALUE = "default-src 'self'";

const dirs = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'write-hosting-files-'));
  dirs.push(dir);
  return dir;
}

// A dist dir and a firebase.json whose hosting headers are `headers`.
function fixture(headers) {
  const dist = tempDir();
  const firebase = join(tempDir(), 'firebase.json');
  writeFileSync(firebase, JSON.stringify({ hosting: { headers } }));
  return { dist, firebase };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const rule = (source, headers) => ({
  source,
  headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
});

describe('HostingFilesError', () => {
  it('is an Error named HostingFilesError', () => {
    const error = new HostingFilesError('x');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HostingFilesError');
    expect(error.message).toBe('x');
  });
});

describe('CATCH_ALL_FORBIDDEN_HEADERS', () => {
  it('is the frozen list of headers refused on the catch-all', () => {
    expect(CATCH_ALL_FORBIDDEN_HEADERS).toEqual(['X-Robots-Tag']);
    expect(Object.isFrozen(CATCH_ALL_FORBIDDEN_HEADERS)).toBe(true);
  });
});

describe('CATCH_ALL_SOURCES', () => {
  it('is the frozen list of catch-all sources', () => {
    expect(CATCH_ALL_SOURCES).toEqual(['**', '/**']);
    expect(Object.isFrozen(CATCH_ALL_SOURCES)).toBe(true);
  });
});

describe('toCloudflarePattern', () => {
  it.each([
    ['/', '/'],
    ['**', '/*'],
    ['/**', '/*'],
    ['/assets/**', '/assets/*'],
    ['/404.html', '/404.html'],
  ])('maps %s to %s', (source, pattern) => {
    expect(toCloudflarePattern(source)).toBe(pattern);
  });

  it.each(['/a/*.js', '/{a,b}', '!/x', 'assets/**', '/a/**/b', '/a/:id', '/a/*', '/a b'])(
    'rejects %s and quotes it',
    (source) => {
      expect(() => toCloudflarePattern(source)).toThrow(HostingFilesError);
      expect(() => toCloudflarePattern(source)).toThrow(source);
    },
  );

  it('rejects a missing source', () => {
    expect(() => toCloudflarePattern(undefined)).toThrow(HostingFilesError);
  });
});

describe('toHeaderRules', () => {
  const CSP = { 'Content-Security-Policy': "default-src 'self'" };
  const CACHE = { 'Cache-Control': 'public,max-age=31536000,immutable' };

  it('rejects a regex rule and a rule without source', () => {
    const regex = { regex: '^/x$', headers: [{ key: 'A', value: 'b' }] };
    expect(() => toHeaderRules({ headers: [regex] })).toThrow(HostingFilesError);
    expect(() => toHeaderRules({ headers: [{ ...regex, source: '/x' }] })).toThrow(
      HostingFilesError,
    );
    expect(() => toHeaderRules({ headers: [{ headers: [] }] })).toThrow(HostingFilesError);
  });

  it('keeps source order and accepts disjoint header names', () => {
    expect(toHeaderRules({ headers: [rule('/assets/**', CACHE), rule('**', CSP)] })).toEqual([
      { pattern: '/assets/*', headers: [{ name: 'Cache-Control', value: CACHE['Cache-Control'] }] },
      {
        pattern: '/*',
        headers: [{ name: 'Content-Security-Policy', value: CSP['Content-Security-Policy'] }],
      },
    ]);
  });

  it('rejects a header set by a splat and a rule it matches, in any case', () => {
    expect(() =>
      toHeaderRules({ headers: [rule('**', CACHE), rule('/assets/**', CACHE)] }),
    ).toThrow(HostingFilesError);
    const lower = rule('/assets/**', { 'cache-control': 'no-cache' });
    expect(() => toHeaderRules({ headers: [rule('**', CACHE), lower] })).toThrow(
      /Cache-Control.*"\/\*".*"\/assets\/\*"/,
    );
  });

  it('rejects overlaps on "/" and on two identical patterns', () => {
    expect(() => toHeaderRules({ headers: [rule('/', CSP), rule('**', CSP)] })).toThrow(
      HostingFilesError,
    );
    const page = rule('/404', { 'Cache-Control': 'public,max-age=3600' });
    expect(() => toHeaderRules({ headers: [page, page] })).toThrow(HostingFilesError);
  });

  it('treats /x/* as matching /x itself', () => {
    const a = rule('/x/**', CACHE);
    expect(() => toHeaderRules({ headers: [rule('/x', CACHE), a] })).toThrow(HostingFilesError);
    expect(() => toHeaderRules({ headers: [rule('/xy', CACHE), a] })).not.toThrow();
  });

  it.each(['**', '/**'])('refuses X-Robots-Tag on %s in any case, naming it', (catchAll) => {
    for (const key of ['X-Robots-Tag', 'x-robots-tag']) {
      const headers = [rule(catchAll, { ...CSP, [key]: 'noindex' })];
      expect(() => toHeaderRules({ headers })).toThrow(HostingFilesError);
      expect(() => toHeaderRules({ headers })).toThrow(`${key} on "/*" would apply to every page`);
    }
  });

  it('keeps X-Robots-Tag on /play and on a non-catch-all splat', () => {
    const robots = { 'X-Robots-Tag': 'noindex' };
    expect(
      toHeaderRules({
        headers: [rule('/play', { 'Cache-Control': 'no-cache', ...robots }), rule('**', CSP)],
      }),
    ).toEqual([
      {
        pattern: '/play',
        headers: [
          { name: 'Cache-Control', value: 'no-cache' },
          { name: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
      {
        pattern: '/*',
        headers: [{ name: 'Content-Security-Policy', value: CSP['Content-Security-Policy'] }],
      },
    ]);
    expect(toHeaderRules({ headers: [rule('/assets/**', robots)] })).toEqual([
      { pattern: '/assets/*', headers: [{ name: 'X-Robots-Tag', value: 'noindex' }] },
    ]);
  });

  it('still rejects overlaps on kept headers', () => {
    expect(() => toHeaderRules({ headers: [rule('/play', CSP), rule('**', CSP)] })).toThrow(
      HostingFilesError,
    );
    const robots = { 'X-Robots-Tag': 'noindex' };
    expect(() =>
      toHeaderRules({ headers: [rule('/assets/**', robots), rule('/assets/x', robots)] }),
    ).toThrow(HostingFilesError);
  });

  it('returns no rules for a hosting without headers', () => {
    expect(toHeaderRules({})).toEqual([]);
    expect(toHeaderRules({ headers: [] })).toEqual([]);
  });

  it('rejects a line break in a header name or value', () => {
    expect(() => toHeaderRules({ headers: [rule('/x', { A: 'b\nc' })] })).toThrow(
      HostingFilesError,
    );
    expect(() => toHeaderRules({ headers: [rule('/x', { 'A\r': 'b' })] })).toThrow(
      HostingFilesError,
    );
  });
});

const one = (pattern, name, value) => ({ pattern, headers: [{ name, value }] });

describe('ASSETS_IGNORE', () => {
  it('keeps source maps off Cloudflare and nothing else', () => {
    expect(ASSETS_IGNORE).toBe('*.map\n');
  });
});

describe('formatHeaders', () => {
  it('writes each pattern with indented headers, rules separated by a blank line', () => {
    expect(formatHeaders([one('/a', 'X', '1'), one('/*', 'Y', '2')])).toBe(
      '/a\n  X: 1\n\n/*\n  Y: 2\n',
    );
  });

  it('writes nothing for no rules', () => {
    expect(formatHeaders([])).toBe('');
  });

  it('accepts 100 rules and rejects 101', () => {
    const rules = Array.from({ length: 101 }, (_, i) => one(`/p${i}`, 'X', '1'));
    expect(() => formatHeaders(rules.slice(0, 100))).not.toThrow();
    expect(() => formatHeaders(rules)).toThrow(HostingFilesError);
  });

  it('accepts a 2,000-character line and rejects 2,001, naming the pattern', () => {
    // "  X: " is 5 characters.
    expect(() => formatHeaders([one('/long', 'X', 'v'.repeat(1995))])).not.toThrow();
    expect(() => formatHeaders([one('/long', 'X', 'v'.repeat(1996))])).toThrow(HostingFilesError);
    expect(() => formatHeaders([one('/long', 'X', 'v'.repeat(1996))])).toThrow('"/long"');
  });
});

describe('writeHostingFiles', () => {
  it('writes _headers and .assetsignore and returns the rule count', () => {
    const { dist, firebase } = fixture([
      { source: '**', headers: [{ key: 'Content-Security-Policy', value: CSP_VALUE }] },
    ]);
    expect(writeHostingFiles({ distDir: dist, firebaseJsonPath: firebase })).toEqual({
      ruleCount: 1,
    });
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toBe(
      `/*\n  Content-Security-Policy: ${CSP_VALUE}\n`,
    );
    expect(readFileSync(join(dist, '.assetsignore'), 'utf8')).toBe('*.map\n');
  });

  it('overwrites earlier files', () => {
    const { dist, firebase } = fixture([]);
    writeFileSync(join(dist, '_headers'), 'old');
    writeHostingFiles({ distDir: dist, firebaseJsonPath: firebase });
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toBe('');
  });

  it('rejects a missing dist without creating it', () => {
    const { firebase } = fixture([]);
    const distDir = join(tempDir(), 'dist');
    expect(() => writeHostingFiles({ distDir, firebaseJsonPath: firebase })).toThrow(
      HostingFilesError,
    );
    expect(existsSync(distDir)).toBe(false);
  });

  it('rejects a file without a hosting object', () => {
    const dist = tempDir();
    const firebase = join(tempDir(), 'firebase.json');
    writeFileSync(firebase, JSON.stringify({ functions: {} }));
    expect(() => writeHostingFiles({ distDir: dist, firebaseJsonPath: firebase })).toThrow(
      HostingFilesError,
    );
  });

  it('writes nothing when a limit is exceeded', () => {
    const { dist, firebase } = fixture([
      { source: '/x', headers: [{ key: 'X', value: 'v'.repeat(2001) }] },
    ]);
    expect(() => writeHostingFiles({ distDir: dist, firebaseJsonPath: firebase })).toThrow(
      HostingFilesError,
    );
    expect(readdirSync(dist)).toEqual([]);
  });
});

describe('write-hosting-files CLI', () => {
  const run = (dist, firebase) =>
    spawnSync(process.execPath, [SCRIPT, '--dist', dist, '--firebase', firebase], {
      encoding: 'utf8',
    });

  it('prints OK and exits 0', () => {
    const { dist, firebase } = fixture([
      { source: '**', headers: [{ key: 'Content-Security-Policy', value: CSP_VALUE }] },
    ]);
    const result = run(dist, firebase);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('write-hosting-files: OK (1 rules)');
  });

  it('prints one error line, exits 1 and writes nothing for an unsupported source', () => {
    const { dist, firebase } = fixture([
      { source: '/a/*.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ]);
    const result = run(dist, firebase);
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr.startsWith('write-hosting-files: ')).toBe(true);
    expect(readdirSync(dist)).toEqual([]);
  });

  it('prints one error line and exits 1 for a missing firebase.json', () => {
    const result = run(tempDir(), join(tempDir(), 'missing.json'));
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(result.stderr.startsWith('write-hosting-files: ')).toBe(true);
  });
});

describe('the real firebase.json', () => {
  const hosting = JSON.parse(readFileSync(FIREBASE_JSON, 'utf8')).hosting;
  const catchAll = hosting.headers.find((r) => r.source === '**');
  const rules = toHeaderRules(hosting);
  const text = formatHeaders(rules);

  it('carries the CSP to /* byte for byte', () => {
    const csp = catchAll.headers.find((h) => h.key === 'Content-Security-Policy').value;
    const splat = rules.find((r) => r.pattern === '/*');
    expect(splat.headers).toEqual(catchAll.headers.map((h) => ({ name: h.key, value: h.value })));
    expect(splat.headers[0]).toEqual({ name: 'Content-Security-Policy', value: csp });
    expect(text).toContain(`/*\n  Content-Security-Policy: ${csp}\n`);
  });

  it('carries every Cache-Control rule, 25 rules in all', () => {
    expect(rules).toHaveLength(25);
    expect(text).toContain('/assets/*\n  Cache-Control: public,max-age=31536000,immutable\n');
    for (const path of ['/', '/index.html']) {
      expect(text).toContain(
        `\n${path}\n  Cache-Control: public,max-age=300\n`.slice(path === '/' ? 1 : 0),
      );
    }
    for (const path of [
      '/faq',
      '/contact',
      '/support',
      '/your-data',
      '/es/*',
      '/pt-br/*',
      '/sitemap.xml',
      '/robots.txt',
    ]) {
      expect(text).toContain(`\n${path}\n  Cache-Control: public,max-age=300\n`);
    }
    expect(text).toContain('\n/site/*\n  Cache-Control: public,max-age=86400\n');
    for (const path of [
      '/legal.js',
      '/legal.css',
    ]) {
      expect(text).toContain(`\n${path}\n  Cache-Control: public,max-age=3600\n`);
    }
    for (const path of ['/404', '/404.html', '/get', '/s']) {
      expect(text).toContain(
        `\n${path}\n  X-Robots-Tag: noindex\n  Cache-Control: public,max-age=300\n`,
      );
    }
    for (const path of ['/es/get', '/pt-br/get', '/es/s', '/pt-br/s']) {
      expect(text).toContain(`\n${path}\n  X-Robots-Tag: noindex\n\n`);
    }
  });

  it('keeps noindex on the 404 page, /get and /s only', () => {
    expect(catchAll.headers.some((h) => h.key === 'X-Robots-Tag')).toBe(false);
    const noindex = rules
      .filter((r) => r.headers.some((h) => h.name.toLowerCase() === 'x-robots-tag'))
      .map((r) => r.pattern);
    expect(noindex).toEqual([
      '/404',
      '/404.html',
      '/get',
      '/es/get',
      '/pt-br/get',
      '/s',
      '/es/s',
      '/pt-br/s',
    ]);
    const splatBlock = text.slice(text.lastIndexOf('/*\n'));
    expect(splatBlock).not.toMatch(/x-robots-tag/i);
    expect(text.match(/X-Robots-Tag: noindex/g)).toHaveLength(8);
  });

  it('holds response headers only: nothing configures Firebase Hosting serving', () => {
    expect(Object.keys(hosting)).toEqual(['headers']);
  });
});
