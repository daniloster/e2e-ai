// Self-tests of the site smoke helpers: the production CSP reader, and the network,
// CSP and console guards on fixture pages served at the site origin (each one a deliberate regression).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { readProductionCsp, withCsp } from './siteCsp';
import {
  analyticsEvents,
  assertNoConsoleErrors,
  assertNoCspViolations,
  assertNoOffOriginRequests,
  installSiteGuards,
} from './siteNetwork';

const FIREBASE_JSON = fileURLToPath(new URL('../firebase.json', import.meta.url));

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

// A temp copy of firebase.json with its hosting.headers rewritten by edit.
function editedCopy(edit: (rules: HeaderRule[]) => HeaderRule[]): string {
  const config = JSON.parse(readFileSync(FIREBASE_JSON, 'utf8')) as {
    hosting: { headers: HeaderRule[] };
  };
  config.hosting.headers = edit(config.hosting.headers);
  const dir = mkdtempSync(join(tmpdir(), 'site-csp-'));
  const file = join(dir, 'firebase.json');
  writeFileSync(file, JSON.stringify(config));
  return file;
}

const isCsp = (h: { key: string }) => h.key.toLowerCase() === 'content-security-policy';

test.describe('readProductionCsp', () => {
  const temps: string[] = [];
  test.afterAll(() => {
    for (const file of temps) rmSync(join(file, '..'), { recursive: true, force: true });
  });

  test('reads the "**" rule of the real firebase.json', () => {
    const csp = readProductionCsp();
    expect(csp.startsWith("default-src 'self'")).toBe(true);
    expect(csp).toContain("script-src 'self' https://www.gstatic.com");
  });

  test('throws when the "**" rule has no CSP', () => {
    const file = editedCopy((rules) =>
      rules.map((rule) => ({ ...rule, headers: rule.headers.filter((h) => !isCsp(h)) })),
    );
    temps.push(file);
    expect(() => readProductionCsp(file)).toThrow(/no Content-Security-Policy/);
  });

  test('throws when another rule also sets a CSP', () => {
    const file = editedCopy((rules) => [
      ...rules,
      {
        source: '/faq',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'" }],
      },
    ]);
    temps.push(file);
    expect(() => readProductionCsp(file)).toThrow(/2 rules set a CSP/);
  });
});

test('withCsp replaces any-case CSP keys under the lower-case key', () => {
  expect(withCsp({ 'Content-Security-Policy': 'x', 'content-type': 'text/html' }, 'y')).toEqual({
    'content-security-policy': 'y',
    'content-type': 'text/html',
  });
});

const HTML = 'text/html; charset=utf-8';
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const CDN = 'https://www.gstatic.com/firebasejs/12.19.0';

function page(body: string): { body: string; contentType: string } {
  return {
    body: `<!doctype html><html lang="en"><head><title>fixture</title></head><body>${body}</body></html>`,
    contentType: HTML,
  };
}

const FIXTURES = {
  '/ph-guard/clean': page(`<p>clean</p><img alt="" src="${PIXEL}">`),
  '/ph-guard/google': page('<img alt="" src="https://www.google-analytics.com/g/collect?v=2">'),
  '/ph-guard/inline': page('<script>window.inlineRan = true;</script>'),
  '/ph-guard/stub': page('<script type="module" src="/ph-guard/stub.js"></script>'),
  '/ph-guard/stub.js': {
    body: `import { initializeApp } from '${CDN}/firebase-app.js';\nimport { getAnalytics, logEvent } from '${CDN}/firebase-analytics.js';\nlogEvent(getAnalytics(initializeApp({})), 'x', { a: 1 });\n`,
    contentType: 'text/javascript; charset=utf-8',
  },
} as const;

test.describe('installSiteGuards', () => {
  test('a clean page passes every assertion and a data: image is not off-origin', async ({
    page: tab,
    baseURL,
  }) => {
    const guards = await installSiteGuards(tab, {
      origin: baseURL ?? '',
      csp: readProductionCsp(),
      fixtures: FIXTURES,
    });
    const response = await tab.goto('/ph-guard/clean');
    await tab.waitForLoadState('networkidle');
    expect(response?.headers()['content-security-policy']).toBe(readProductionCsp());
    expect(guards.offOrigin).toEqual([]);
    assertNoOffOriginRequests(guards);
    assertNoCspViolations(guards);
    assertNoConsoleErrors(guards);
  });

  test('a Google request is recorded, aborted and fails assertNoOffOriginRequests', async ({
    page: tab,
    baseURL,
  }) => {
    const guards = await installSiteGuards(tab, {
      origin: baseURL ?? '',
      csp: readProductionCsp(),
      fixtures: FIXTURES,
    });
    const failed: string[] = [];
    tab.on('requestfailed', (request) => {
      failed.push(`${request.url()} ${request.failure()?.errorText ?? ''}`);
    });
    await tab.goto('/ph-guard/google');
    await tab.waitForLoadState('networkidle');
    expect(() => assertNoOffOriginRequests(guards)).toThrow(
      /https:\/\/www\.google-analytics\.com\/g\/collect/,
    );
    expect(failed).toEqual([
      expect.stringMatching(
        /^https:\/\/www\.google-analytics\.com\/g\/collect\?v=2 net::ERR_BLOCKED_BY_CLIENT/,
      ),
    ]);
  });

  test('an inline script fails assertNoCspViolations, so the CSP header is applied', async ({
    page: tab,
    baseURL,
  }) => {
    const guards = await installSiteGuards(tab, {
      origin: baseURL ?? '',
      csp: readProductionCsp(),
      fixtures: FIXTURES,
    });
    await tab.goto('/ph-guard/inline');
    await tab.waitForLoadState('networkidle');
    expect(await tab.evaluate(() => (window as { inlineRan?: boolean }).inlineRan)).toBeUndefined();
    await expect.poll(() => guards.cspViolations.length).toBeGreaterThan(0);
    expect(() => assertNoCspViolations(guards)).toThrow(/script-src/);
  });

  test('the Firebase stub records both CDN modules and the logged event', async ({
    page: tab,
    baseURL,
  }) => {
    const guards = await installSiteGuards(tab, {
      origin: baseURL ?? '',
      csp: readProductionCsp(),
      fixtures: FIXTURES,
    });
    await tab.goto('/ph-guard/stub');
    await expect.poll(() => analyticsEvents(tab)).toEqual([{ name: 'x', params: { a: 1 } }]);
    expect([...guards.firebase].sort()).toEqual([
      `${CDN}/firebase-analytics.js`,
      `${CDN}/firebase-app.js`,
    ]);
    assertNoCspViolations(guards);
    assertNoConsoleErrors(guards);
  });

  test('the assertions return normally on empty lists and list every entry otherwise', () => {
    const empty = {
      offOrigin: [],
      firebase: [],
      consoleErrors: [],
      pageErrors: [],
      cspViolations: [],
    };
    assertNoOffOriginRequests(empty);
    assertNoCspViolations(empty);
    assertNoConsoleErrors(empty);
    expect(() =>
      assertNoConsoleErrors({ ...empty, consoleErrors: ['a'], pageErrors: ['b'] }),
    ).toThrow(/2 console or page error\(s\):\n  console: a\n  pageerror: b/);
  });
});
