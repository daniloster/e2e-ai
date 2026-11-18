// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { BUDGET, budgetError, budgetFailures, checkBudget, formatItem } from './site-budget.mjs';

const SCRIPT = fileURLToPath(new URL('./site-budget.mjs', import.meta.url));

const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENTRY_PAGE =
  '<html><head><script type="module" src="/assets/entry.js?v=1"></script></head></html>';

// A temp dist with the given files and, unless null, a site-pages.json listing `pages` (out paths).
function dist(files, pages = ['index.html']) {
  const dir = mkdtempSync(join(tmpdir(), 'site-budget-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  if (pages !== null) {
    const manifest = pages.map((file) => ({
      path: `/${file}`,
      file,
      url: '',
      lang: 'en',
      page: 'home',
    }));
    writeFileSync(join(dir, 'site-pages.json'), JSON.stringify(manifest));
  }
  return dir;
}

function jsOf(items, file = 'index.html') {
  return items.find((item) => item.kind === 'js' && item.file === file);
}

describe('BUDGET and budgetError', () => {
  it('freezes the three limits', () => {
    expect(BUDGET).toEqual({ jsPerPageGzip: 30_720, htmlPerPage: 61_440, image: 256_000 });
    expect(Object.isFrozen(BUDGET)).toBe(true);
  });

  it('returns a plain Error named BudgetError', () => {
    const error = budgetError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BudgetError');
    expect(error.message).toBe('boom');
  });
});

describe('checkBudget', () => {
  it('fails a page whose JS is over budget only through a static import', () => {
    const dir = dist({
      'index.html': ENTRY_PAGE,
      'assets/entry.js': `import"./dep.js";${'x'.repeat(1024)}`,
      'assets/dep.js': randomBytes(31 * 1024),
    });
    const items = checkBudget(dir);
    const js = jsOf(items);
    expect(js.gzipBytes).toBeGreaterThan(30_720);
    expect(budgetFailures(items)).toEqual([js]);
  });

  it('passes a small graph and does not count dynamic imports', () => {
    const small = dist({
      'index.html': ENTRY_PAGE,
      'assets/entry.js': 'import"./dep.js";',
      'assets/dep.js': randomBytes(2 * 1024),
    });
    expect(budgetFailures(checkBudget(small))).toEqual([]);
    const lazy = dist({
      'index.html': ENTRY_PAGE,
      'assets/entry.js': 'import"./dep.js";const m=()=>import("./lazy.js");import ("./lazy.js");',
      'assets/dep.js': randomBytes(2 * 1024),
      'assets/lazy.js': randomBytes(40 * 1024),
    });
    const items = checkBudget(lazy);
    expect(budgetFailures(items)).toEqual([]);
    expect(jsOf(items).bytes).toBeLessThan(3 * 1024);
  });

  it('follows named imports, re-exports and root specifiers, and skips bare, http and data ones', () => {
    const entry =
      'import{a as b}from"./b.js?x";export*from"../c.js#h";import"/assets/d.js";import"react";import"https://x.test/e.js";import"data:text/javascript,1";';
    const dir = dist({
      'index.html':
        '<link rel="modulepreload" crossorigin href="/assets/a.js"><link rel="stylesheet" href="/assets/s.css">',
      'assets/a.js': entry,
      'assets/b.js': 'b',
      'c.js': 'c',
      'assets/d.js': 'd',
    });
    // a.js plus the three one-byte files it reaches; react, https: and data: would throw if followed.
    expect(jsOf(checkBudget(dir)).bytes).toBe(Buffer.byteLength(entry) + 3);
  });

  it('counts inline module scripts but not JSON-LD or classic scripts', () => {
    const code = 'console.log(1)';
    const dir = dist({
      'index.html': `<script type="application/ld+json">{"a":1}</script><script>var a=1</script><script type="module">${code}</script>`,
    });
    const js = jsOf(checkBudget(dir));
    expect(js.bytes).toBe(code.length);
    expect(js.gzipBytes).toBeGreaterThan(0);
  });

  it('yields a zero js item for a page with no script, without throwing', () => {
    const items = checkBudget(dist({ 'index.html': '<html><body>hi</body></html>' }));
    expect(jsOf(items)).toEqual({
      file: 'index.html',
      kind: 'js',
      bytes: 0,
      gzipBytes: 0,
      limit: 30_720,
    });
    expect(budgetFailures(items)).toEqual([]);
  });

  it('counts each file of an import cycle once and terminates', () => {
    const dir = dist({
      'index.html': ENTRY_PAGE,
      'assets/entry.js': 'import"./b.js";',
      'assets/b.js': 'import"./entry.js";',
    });
    expect(jsOf(checkBudget(dir)).bytes).toBe(
      'import"./b.js";'.length + 'import"./entry.js";'.length,
    );
  });

  it('returns html then js per page in manifest order, then sorted images', () => {
    const dir = dist(
      {
        'index.html': '<p>en</p>',
        'es/rules.html': '<p>es</p>',
        'site/screens/b.png': 'b',
        'site/screens/a.JPG': 'aa',
        'site/screens/README.md': 'readme',
      },
      ['index.html', 'es/rules.html'],
    );
    const items = checkBudget(dir);
    expect(items.map((item) => `${item.kind} ${item.file}`)).toEqual([
      'html index.html',
      'js index.html',
      'html es/rules.html',
      'js es/rules.html',
      'image site/screens/a.JPG',
      'image site/screens/b.png',
    ]);
    expect(items[0]).toEqual({ file: 'index.html', kind: 'html', bytes: 9, limit: 61_440 });
    expect(items[4]).toEqual({
      file: 'site/screens/a.JPG',
      kind: 'image',
      bytes: 2,
      limit: 256_000,
    });
  });

  it('fails a 300 kB screenshot and ignores the screens README', () => {
    const items = checkBudget(
      dist({
        'index.html': '',
        'site/screens/big.jpg': Buffer.alloc(300_000),
        'site/screens/README.md': 'x',
      }),
    );
    expect(budgetFailures(items).map((item) => item.file)).toEqual(['site/screens/big.jpg']);
    expect(items.some((item) => item.file.endsWith('README.md'))).toBe(false);
  });

  it('fails a 61 441-byte page and passes a 61 440-byte one', () => {
    const over = checkBudget(dist({ 'index.html': 'x'.repeat(61_441) }));
    expect(budgetFailures(over).map((item) => item.kind)).toEqual(['html']);
    expect(budgetFailures(checkBudget(dist({ 'index.html': 'x'.repeat(61_440) })))).toEqual([]);
  });

  it.each([
    [
      'a missing site-pages.json',
      () => dist({ 'index.html': '' }, null),
      /site-pages\.json is missing/,
    ],
    [
      'an empty manifest',
      () => dist({ 'index.html': '' }, []),
      /site-pages\.json must be a non-empty array/,
    ],
    ['a file outside dist', () => dist({}, ['../x.html']), /\.\.\/x\.html/],
    ['a missing page file', () => dist({}, ['rules.html']), /rules\.html is missing/],
    [
      'a missing referenced script',
      () => dist({ 'index.html': '<script type="module" src="/assets/missing.js"></script>' }),
      /index\.html: missing script \/assets\/missing\.js/,
    ],
    [
      'a missing imported script',
      () => dist({ 'index.html': ENTRY_PAGE, 'assets/entry.js': 'import"./gone.js";' }),
      /missing script \/assets\/gone\.js/,
    ],
  ])('throws a BudgetError on %s', (_case, make, message) => {
    const dir = make();
    let thrown;
    try {
      checkBudget(dir);
    } catch (error) {
      thrown = error;
    }
    expect(thrown?.name).toBe('BudgetError');
    expect(thrown?.message).toMatch(message);
  });
});

describe('formatItem', () => {
  it('formats sizes in kB to one decimal, gzip for js', () => {
    expect(
      formatItem({
        file: 'index.html',
        kind: 'js',
        bytes: 40_000,
        gzipBytes: 12_595,
        limit: 30_720,
      }),
    ).toBe('PASS js index.html 12.3 kB / 30.0 kB');
    expect(
      formatItem({ file: 'site/screens/a.jpg', kind: 'image', bytes: 300_000, limit: 256_000 }),
    ).toBe('FAIL image site/screens/a.jpg 293.0 kB / 250.0 kB');
  });
});

describe('site-budget CLI', () => {
  function run(dir) {
    return spawnSync(process.execPath, [SCRIPT, '--dist', dir], { encoding: 'utf8' });
  }

  it('prints every item then OK and exits 0', () => {
    const result = run(dist({ 'index.html': '<p>hi</p>' }));
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'site-budget: PASS html index.html 0.0 kB / 60.0 kB',
      'site-budget: PASS js index.html 0.0 kB / 30.0 kB',
      'site-budget: OK (2 checks)',
    ]);
  });

  it('prints FAIL with the count and exits 1 when an item is over budget', () => {
    const result = run(dist({ 'index.html': 'x'.repeat(61_441) }));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('site-budget: FAIL html index.html 60.0 kB / 60.0 kB');
    expect(result.stderr).toContain('site-budget: FAIL (1 of 2 over budget)');
  });

  it('prints the error and exits 1 on a structural problem', () => {
    const result = run(dist({}, null));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^site-budget: FAIL .*site-pages\.json is missing/m);
  });

  it('has no side effect on import', async () => {
    const before = process.exitCode;
    await import('./site-budget.mjs');
    expect(process.exitCode).toBe(before);
  });
});
