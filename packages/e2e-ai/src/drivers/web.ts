// Web driver: Playwright (Chromium). The snapshot is an accessibility-flavoured flattening of the DOM
// (role, accessible name, text, data-testid, placeholder), small enough for a 1B model's context.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import type { Driver, RouteSpec, UiElement } from '../types.ts';

// Runs in the page. Tags each kept element with data-e2e-ref so actions can find it again.
export const SNAPSHOT_FN = `(() => {
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
    if (t === 'button') return 'button';
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'submit' || ty === 'button') return 'button';
      return 'textbox';
    }
    if (t === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'li') return 'listitem';
    return '';
  };
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
    const role = el.getAttribute('role') || implicitRole(el);
    const testId = el.getAttribute('data-testid') || undefined;
    const isLeafText = !role && el.children.length === 0 && ownText(el).length > 0 && !['SCRIPT','STYLE'].includes(el.tagName);
    if (!role && !testId && !isLeafText) continue;
    const text = ownText(el);
    const name = (labelFor(el) || (role === 'textbox' ? el.getAttribute('placeholder') || '' : text)).slice(0, 120);
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

export interface WebDriverOptions {
  baseUrl: string;
  routes: Record<string, RouteSpec>;
  headless?: boolean;
  /** The URL resetApp opens (relative to baseUrl). */
  startPath?: string;
}

const VIEWPORT = { width: 420, height: 860 };

export function createWebDriver(opts: WebDriverOptions): Driver {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let recording: { stem: string; dir: string } | undefined;
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

  return {
    platform: 'web',
    name: 'playwright-chromium',
    async start() {
      const { chromium } = await import('@playwright/test');
      browser = await chromium.launch({ headless: opts.headless ?? true });
    },
    async stop() {
      await browser?.close();
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
      return (await need().evaluate(SNAPSHOT_FN)) as UiElement[];
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
}
