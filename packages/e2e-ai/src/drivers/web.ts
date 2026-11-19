// Web driver: Playwright (Chromium). The snapshot is an accessibility-flavoured flattening of the DOM
// (role, accessible name, text, data-testid, placeholder), small enough for a 1B model's context.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { redact, remoteBrowser, sessionUrl, validateCloud, type CloudConfig } from '../cloud/cloud.ts';
import { openTunnel, type Tunnel } from '../cloud/tunnel.ts';
import { currentRoles, WEB_ROLES } from '../roles.ts';
import type { Driver, DriverLink, RouteSpec, UiElement } from '../types.ts';

/**
 * The in-page snapshot, with the role map (defaults + config `ui.roles.web`) built in. Runs in the
 * page; tags each kept element with data-e2e-ref so actions can find it again.
 */
export function snapshotScript(): string {
  const map = { ...WEB_ROLES, ...(currentRoles().web ?? {}) };
  return SNAPSHOT_SOURCE.replace('__ROLE_MAP__', JSON.stringify(map));
}

const SNAPSHOT_SOURCE = `(() => {
  const ROLE_MAP = __ROLE_MAP__;
  const out = [];
  let n = 0;
  document.querySelectorAll('[data-e2e-ref]').forEach((e) => e.removeAttribute('data-e2e-ref'));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const implicitRole = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'hidden') return '';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'range') return 'slider';
      if (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image') return 'button';
      return 'textbox';
    }
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'img') return el.getAttribute('alt') ? 'image' : '';
    if (t === 'ul' || t === 'ol') return '';
    return ROLE_MAP[t] || '';
  };
  const OVERLAYS = ['dialog', 'alert'];
  const labelFor = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    if (el.id) { const l = document.querySelector('label[for="' + el.id + '"]'); if (l) return l.textContent.trim(); }
    const wrap = el.closest('label'); if (wrap) return wrap.textContent.trim();
    return '';
  };
  const ownText = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const aria = el.getAttribute('role');
    const role = aria ? ROLE_MAP[aria] || aria : implicitRole(el);
    const testId = el.getAttribute('data-testid') || undefined;
    const isLeafText = !role && el.children.length === 0 && ownText(el).length > 0 && !['SCRIPT','STYLE'].includes(el.tagName);
    if (!role && !testId && !isLeafText) continue;
    const text = ownText(el);
    // A dialog/alert is named by its label or its first heading (its text is everything in it).
    const heading = OVERLAYS.includes(role) ? (el.querySelector('h1,h2,h3,h4,[role=heading]')?.textContent || '').trim() : '';
    const name = (labelFor(el) || heading || (role === 'textbox' ? el.getAttribute('placeholder') || '' : text)).slice(0, 120);
    const item = { ref: String(n), role: role || 'text', name, text };
    if (testId) item.testId = testId;
    if (el.getAttribute('placeholder')) item.placeholder = el.getAttribute('placeholder');
    if ('value' in el && role === 'textbox') item.value = el.value;
    if (role === 'checkbox') item.checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
    el.setAttribute('data-e2e-ref', String(n));
    n++;
    out.push(item);
  }
  return out;
})()`;

/** The snapshot with the default roles (kept for callers that do not configure roles). */
export const SNAPSHOT_FN = snapshotScript();

export interface WebDriverOptions {
  baseUrl: string;
  routes: Record<string, RouteSpec>;
  headless?: boolean;
  /** The URL resetApp opens (relative to baseUrl). */
  startPath?: string;
  /** Run the browser on Sauce Labs / BrowserStack instead of locally. */
  cloud?: CloudConfig;
  sessionName?: string;
}

/** Sets env vars for the duration of `fn` (Playwright's Selenium mode reads them at launch). */
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const VIEWPORT = { width: 420, height: 860 };

export function createWebDriver(opts: WebDriverOptions): Driver {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let recording: { stem: string; dir: string } | undefined;
  let tunnel: Tunnel | undefined;
  let statusScript: ((passed: boolean, reason: string) => string) | undefined;
  let cloudLink: string | undefined;
  if (opts.cloud) validateCloud(opts.cloud);
  const need = (): Page => {
    if (!page) throw new Error('web driver not started');
    return page;
  };
  const routeUrl = (route: string, params: Record<string, string> = {}): string => {
    const spec = opts.routes[route];
    if (!spec?.web) throw new Error(`route ${route} has no web path`);
    let path = spec.web.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
    const extra = Object.entries(params).filter(([k]) => !spec.web?.includes(`{${k}}`));
    if (extra.length) {
      const [base, hash = ''] = path.split('#');
      const sep = (base ?? '').includes('?') ? '&' : '?';
      path = `${base}${sep}${new URLSearchParams(extra).toString()}${hash ? `#${hash}` : ''}`;
    }
    return new URL(path, opts.baseUrl).toString();
  };

  const driver: Driver = {
    platform: 'web',
    name: opts.cloud ? `playwright-${opts.cloud.provider}` : 'playwright-chromium',
    async start() {
      const { chromium } = await import('@playwright/test');
      if (!opts.cloud) {
        browser = await chromium.launch({ headless: opts.headless ?? true });
        return;
      }
      tunnel = await openTunnel(opts.cloud);
      try {
        const { version } = (await import('@playwright/test/package.json', { with: { type: 'json' } })).default as { version: string };
        const remote = remoteBrowser(opts.cloud, {
          playwrightVersion: version,
          ...(tunnel ? { tunnelName: tunnel.name } : {}),
          ...(opts.sessionName ? { sessionName: opts.sessionName } : {}),
        });
        if (remote.kind === 'connect') {
          browser = await chromium.connect(remote.wsEndpoint, { timeout: 120_000 });
          statusScript = remote.statusScript;
        } else {
          browser = await withEnv(remote.env, () => chromium.launch({ headless: false }));
        }
      } catch (e) {
        await tunnel?.stop();
        tunnel = undefined;
        // Remote endpoints carry credentials (BrowserStack caps); never echo them.
        const cred = opts.cloud.accessKey ? { username: '', accessKey: opts.cloud.accessKey } : undefined;
        throw new Error(redact(e instanceof Error ? e.message : String(e), cred));
      }
    },
    async stop(outcome) {
      if (statusScript && outcome) {
        const reason = `${outcome.scenarios - outcome.failed}/${outcome.scenarios} scenarios passed`;
        const p = page ?? (await browser?.newPage().catch(() => undefined));
        await p?.evaluate(() => undefined, statusScript(outcome.passed, reason)).catch(() => undefined);
      }
      await browser?.close();
      await tunnel?.stop();
      tunnel = undefined;
    },
    async links(): Promise<DriverLink[]> {
      if (!opts.cloud || !browser) return [];
      if (cloudLink) return [{ label: `${opts.cloud.provider} session (video, logs)`, url: cloudLink }];
      if (opts.cloud.provider === 'browserstack') {
        // The session's public link, from BrowserStack's executor.
        try {
          const p = page ?? (await browser.newPage());
          const raw = (await p.evaluate(() => undefined, 'browserstack_executor: {"action": "getSessionDetails"}')) as unknown;
          const j = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { public_url?: string; hashed_id?: string } | undefined;
          cloudLink = j?.public_url ?? (j?.hashed_id ? sessionUrl(opts.cloud, j.hashed_id, 'web') : undefined);
        } catch {
          cloudLink = undefined;
        }
      }
      return cloudLink ? [{ label: `${opts.cloud.provider} session (video, logs)`, url: cloudLink }] : [];
    },
    async resetApp() {
      await context?.close();
      if (!browser) throw new Error('web driver not started');
      context = await browser.newContext({ viewport: VIEWPORT });
      page = await context.newPage();
      await page.goto(new URL(opts.startPath ?? '/', opts.baseUrl).toString());
    },
    // Playwright records per browser context, so recording restarts the context on the same URL.
    async startRecording(stem) {
      if (!browser) throw new Error('web driver not started');
      const url = page?.url();
      const dir = join(dirname(stem), '.raw');
      mkdirSync(dir, { recursive: true });
      const storage = await context?.storageState();
      await context?.close();
      context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir, size: VIEWPORT }, ...(storage ? { storageState: storage } : {}) });
      page = await context.newPage();
      if (url) await page.goto(url);
      recording = { stem, dir };
    },
    async stopRecording() {
      if (!recording || !page || !context) return undefined;
      const video = page.video();
      const out = `${recording.stem}.webm`;
      const url = page.url();
      await context.close();
      await video?.saveAs(out);
      await video?.delete();
      recording = undefined;
      context = await (browser as Browser).newContext({ viewport: VIEWPORT });
      page = await context.newPage();
      await page.goto(url).catch(() => undefined);
      return video ? out : undefined;
    },
    async openRoute(route, params) {
      const p = need();
      const url = routeUrl(route, params);
      await p.goto(url);
      // Hash-only navigations do not reload; make the app re-read its URL.
      await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    },
    async snapshot(): Promise<UiElement[]> {
      return (await need().evaluate(snapshotScript())) as UiElement[];
    },
    async tap(ref) {
      await need().locator(`[data-e2e-ref="${ref}"]`).click({ timeout: 1000 });
    },
    async fill(ref, text) {
      await need().locator(`[data-e2e-ref="${ref}"]`).fill(text, { timeout: 1000 });
    },
    async navigate(target) {
      const p = need();
      await p.goto(new URL(target, opts.baseUrl).toString());
      await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    },
    async screenshot(path) {
      mkdirSync(dirname(path), { recursive: true });
      await need().screenshot({ path });
    },
  };
  if (opts.cloud) {
    // The vendor records the session; per-context recording on a remote browser is not portable.
    delete driver.startRecording;
    delete driver.stopRecording;
  }
  return driver;
}
