// Per-page guards of the site smoke. One route handler owns every request (Playwright
// runs overlapping routes in reverse registration order, so a second one would bypass the first): it
// adds the production CSP to same-origin documents, answers the Firebase CDN modules with a local stub
// and records + aborts every other off-origin request, so the suite never contacts a third party.
import type { Page } from '@playwright/test';

import { withCsp } from './siteCsp';

export interface SiteGuards {
  offOrigin: string[];
  firebase: string[];
  consoleErrors: string[];
  pageErrors: string[];
  cspViolations: string[];
}

const FIREBASE_CDN =
  /^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|analytics)\.js$/;

// Just enough of firebase/app and firebase/analytics for src/firebase.ts load() and track().
const FIREBASE_STUB: Readonly<Record<'app' | 'analytics', string>> = Object.freeze({
  app: 'export function initializeApp(config) { return { options: config }; }\n',
  analytics: [
    'export async function isSupported() { return true; }',
    'export function getAnalytics(app) { return { app }; }',
    'export function initializeAnalytics(app) { return { app }; }',
    'export function logEvent(_analytics, name, params) {',
    '  (globalThis.__pnAnalytics ??= []).push({ name, params });',
    '}',
    '',
  ].join('\n'),
});

// Registered before the first navigation; reports each violation as '<directive> <blockedURI>'.
const CSP_LISTENER = `document.addEventListener('securitypolicyviolation', (e) => {
  window.__pnCspViolation(e.violatedDirective + ' ' + e.blockedURI);
});`;

export async function installSiteGuards(
  page: Page,
  opts: {
    origin: string;
    csp: string;
    fixtures?: Readonly<Record<string, { body: string; contentType: string }>>;
  },
): Promise<SiteGuards> {
  const guards: SiteGuards = {
    offOrigin: [],
    firebase: [],
    consoleErrors: [],
    pageErrors: [],
    cspViolations: [],
  };
  const origin = new URL(opts.origin).origin;
  await page.exposeFunction('__pnCspViolation', (entry: string) => {
    guards.cspViolations.push(entry);
  });
  await page.addInitScript(CSP_LISTENER);
  page.on('console', (message) => {
    if (message.type() === 'error') guards.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    guards.pageErrors.push(error.message);
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin === origin) {
      const fixture = opts.fixtures?.[url.pathname];
      if (fixture !== undefined) {
        return route.fulfill({
          status: 200,
          body: fixture.body,
          contentType: fixture.contentType,
          headers: { 'content-security-policy': opts.csp },
        });
      }
      if (request.resourceType() === 'document') {
        const response = await route.fetch({ maxRedirects: 0 });
        return route.fulfill({ response, headers: withCsp(response.headers(), opts.csp) });
      }
      return route.continue();
    }
    guards.offOrigin.push(request.url());
    const cdn = FIREBASE_CDN.exec(request.url());
    if (cdn !== null) {
      guards.firebase.push(request.url());
      return route.fulfill({
        status: 200,
        body: FIREBASE_STUB[cdn[1] as 'app' | 'analytics'],
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return route.abort('blockedbyclient');
  });
  return guards;
}

function assertEmpty(entries: readonly string[], what: string): void {
  if (entries.length > 0) {
    throw new Error(`${entries.length} ${what}:\n${entries.map((e) => `  ${e}`).join('\n')}`);
  }
}

export function assertNoOffOriginRequests(g: SiteGuards): void {
  assertEmpty(g.offOrigin, 'off-origin request(s)');
}

export function assertNoCspViolations(g: SiteGuards): void {
  assertEmpty(g.cspViolations, 'CSP violation(s)');
}

export function assertNoConsoleErrors(g: SiteGuards): void {
  assertEmpty(
    [...g.consoleErrors.map((e) => `console: ${e}`), ...g.pageErrors.map((e) => `pageerror: ${e}`)],
    'console or page error(s)',
  );
}

export async function analyticsEvents(
  page: Page,
): Promise<Array<{ name: string; params: unknown }>> {
  return page.evaluate(() => {
    const events = (globalThis as { __pnAnalytics?: Array<{ name: string; params: unknown }> })
      .__pnAnalytics;
    return events === undefined ? [] : [...events];
  });
}
