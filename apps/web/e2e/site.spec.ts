// Smoke over the built site: every page x locale listed in dist/site-pages.json, served
// by https/serve.mjs with the production CSP added and every off-origin request blocked.
// Run: npm run e2e:site -w @pn/web (builds dist/ first).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { isFirebaseConfigured } from '../src/firebase';
import { readProductionCsp } from './siteCsp';
import {
  analyticsEvents,
  assertNoConsoleErrors,
  assertNoCspViolations,
  assertNoOffOriginRequests,
  installSiteGuards,
} from './siteNetwork';

interface SitePageEntry {
  path: string;
  file: string;
  url: string;
  lang: 'en-GB' | 'es' | 'pt-BR';
  page: string;
}

const MANIFEST = fileURLToPath(new URL('../dist/site-pages.json', import.meta.url));
if (!existsSync(MANIFEST)) {
  throw new Error(`${MANIFEST} is missing: run npm run build -w @pn/web (npm run e2e:site does)`);
}
const PAGES = JSON.parse(readFileSync(MANIFEST, 'utf8')) as readonly SitePageEntry[];

const OG_LOCALE = { 'en-GB': 'en_GB', es: 'es_LA', 'pt-BR': 'pt_BR' } as const;
const HREFLANGS = ['en-GB', 'es', 'pt-BR'] as const;

function urlOf(page: string, lang: SitePageEntry['lang']): string | undefined {
  return PAGES.find((p) => p.page === page && p.lang === lang)?.url;
}

test('the manifest lists every page and locale', () => {
  expect(PAGES.length).toBeGreaterThanOrEqual(21);
  const paths = PAGES.map((p) => p.path);
  for (const slug of ['', 'faq', 'contact', 'support', 'your-data', 'get', 's']) {
    for (const prefix of ['/', '/es/', '/pt-br/']) expect(paths).toContain(`${prefix}${slug}`);
  }
});

for (const entry of PAGES) {
  test.describe(entry.path, () => {
    test('head and clean load', async ({ page, context, baseURL }) => {
      const guards = await installSiteGuards(page, {
        origin: baseURL ?? '',
        csp: readProductionCsp(),
      });
      const response = await page.goto(entry.path);
      expect(response?.status()).toBe(200);

      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', entry.lang);
      await expect(html).toHaveAttribute('data-site-page', entry.page);

      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      await expect(canonical).toHaveAttribute('href', entry.url);

      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute('hreflang') ?? '', l.getAttribute('href') ?? '']),
        );
      const expected = [
        ...HREFLANGS.map((lang) => [lang, urlOf(entry.page, lang)]),
        ['x-default', urlOf(entry.page, 'en-GB')],
      ];
      expect([...alternates].sort()).toEqual([...expected].sort());

      const meta = (property: string) =>
        page.locator(`meta[property="${property}"]`).first().getAttribute('content');
      expect((await page.title()).trim()).not.toBe('');
      expect((await meta('og:title'))?.trim()).toBeTruthy();
      expect((await meta('og:description'))?.trim()).toBeTruthy();
      expect(await meta('og:url')).toBe(entry.url);
      expect(await meta('og:image')).toMatch(/^https:\/\/pocketnotes\.app\/site\//);
      expect(await meta('og:locale')).toBe(OG_LOCALE[entry.lang]);

      await page.waitForLoadState('networkidle');
      assertNoOffOriginRequests(guards);
      assertNoCspViolations(guards);
      assertNoConsoleErrors(guards);
      const cookies = await context.cookies();
      expect(cookies.filter((c) => c.name.startsWith('_ga')).map((c) => c.name)).toEqual([]);
      expect(await page.evaluate(() => localStorage.getItem('pn.consent'))).toBeNull();
    });

    test('focus order: skip link, the consent buttons, then the brand link home', async ({
      page,
      baseURL,
    }) => {
      await installSiteGuards(page, { origin: baseURL ?? '', csp: readProductionCsp() });
      await page.goto(entry.path);
      const focused = (attribute: string) =>
        page.evaluate((name) => document.activeElement?.getAttribute(name) ?? null, attribute);
      await page.keyboard.press('Tab');
      expect(await focused('href')).toBe('#main');
      // No choice recorded yet: the banner opens the header, Allow first, both equal weight.
      await page.keyboard.press('Tab');
      expect(await focused('data-consent')).toBe('accept');
      await page.keyboard.press('Tab');
      expect(await focused('data-consent')).toBe('decline');
      await page.keyboard.press('Tab');
      expect(await focused('href')).toBe(
        entry.lang === 'en-GB' ? '/' : `/${entry.path.split('/')[1]}/`,
      );
    });

    test.describe('at 360x740', () => {
      test.use({ viewport: { width: 360, height: 740 } });

      test('no horizontal scroll', async ({ page, baseURL }) => {
        await installSiteGuards(page, { origin: baseURL ?? '', csp: readProductionCsp() });
        await page.goto(entry.path);
        await page.waitForLoadState('networkidle');
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      });
    });
  });
}

// One en-GB entry per distinct page id, in manifest order.
function firstEnEntryPerPage(pages: readonly SitePageEntry[]): SitePageEntry[] {
  const seen = new Set<string>();
  return pages.filter((p) => p.lang === 'en-GB' && !seen.has(p.page) && seen.add(p.page));
}

const CDN_PREFIX = 'https://www.gstatic.com/firebasejs/';
const FIREBASE_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies: { firebase: string };
  }
).dependencies.firebase;

// The committed web config holds REPLACE_ME until a Firebase project exists: then "Allow
// analytics" records the choice and loads nothing. Once configured, the full check runs.
const FIREBASE_CONFIGURED = isFirebaseConfigured();

test('/: Allow analytics with an unconfigured Firebase stores the choice and loads nothing', async ({
  page,
  baseURL,
}) => {
  test.skip(FIREBASE_CONFIGURED, 'Firebase is configured: the per-page checks below run instead');
  const guards = await installSiteGuards(page, { origin: baseURL ?? '', csp: readProductionCsp() });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-consent="accept"]').click();
  await page.waitForTimeout(1_000);
  expect(guards.firebase).toEqual([]);
  expect(guards.offOrigin).toEqual([]);
  assertNoConsoleErrors(guards);
  const consent = await page.evaluate(() => localStorage.getItem('pn.consent'));
  expect((JSON.parse(consent ?? '{}') as { analytics?: unknown }).analytics).toBe(true);
});

for (const entry of firstEnEntryPerPage(PAGES)) {
  test(`${entry.path}: Allow analytics starts Firebase and sends site_page_view`, async ({
    page,
    baseURL,
  }) => {
    test.skip(!FIREBASE_CONFIGURED, 'Firebase web config still holds REPLACE_ME');
    const guards = await installSiteGuards(page, {
      origin: baseURL ?? '',
      csp: readProductionCsp(),
    });
    await page.goto(entry.path);
    await page.waitForLoadState('networkidle');
    expect(guards.firebase).toEqual([]);
    await page.locator('[data-consent="accept"]').click();

    const cdnModules = () =>
      guards.firebase
        .filter((url) => url.startsWith(CDN_PREFIX))
        .map((url) => url.slice(url.lastIndexOf('/') + 1))
        .sort();
    await expect
      .poll(cdnModules, { timeout: 10_000 })
      .toEqual(['firebase-analytics.js', 'firebase-app.js']);

    const order = async () => {
      const events = await analyticsEvents(page);
      const view = events.findIndex(
        (e) =>
          e.name === 'site_page_view' &&
          JSON.stringify(e.params) === JSON.stringify({ page: entry.page, locale: 'en-GB' }),
      );
      const choice = events.findIndex(
        (e, i) =>
          i > view &&
          e.name === 'consent_choice' &&
          JSON.stringify(e.params) === JSON.stringify({ analytics: true }),
      );
      return view >= 0 && choice > view;
    };
    await expect.poll(order, { timeout: 10_000 }).toBe(true);

    for (const url of guards.firebase) expect(url).toContain(`/firebasejs/${FIREBASE_VERSION}/`);
    const consent = await page.evaluate(() => localStorage.getItem('pn.consent'));
    expect((JSON.parse(consent ?? '{}') as { analytics?: unknown }).analytics).toBe(true);
    expect(guards.offOrigin.filter((url) => !guards.firebase.includes(url))).toEqual([]);
  });
}

test('/: No thanks loads nothing', async ({ page, baseURL }) => {
  const guards = await installSiteGuards(page, { origin: baseURL ?? '', csp: readProductionCsp() });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-consent="decline"]').click();
  await page.waitForTimeout(1_000);
  expect(guards.firebase).toEqual([]);
  expect(guards.offOrigin).toEqual([]);
  expect(await analyticsEvents(page)).toEqual([]);
  const consent = await page.evaluate(() => localStorage.getItem('pn.consent'));
  expect((JSON.parse(consent ?? '{}') as { analytics?: unknown }).analytics).toBe(false);
});
