// Mobile driver through Appium (W3C WebDriver over HTTP; no client library). The engine asks Appium
// for the page source, taps/types through Appium, opens e2e deep links, and records the screen with
// Appium's recorder — Appium (XCUITest on iOS, UiAutomator2 on Android) does all device interaction.
//
// Config (e2e-ai.config.json → targets.<name>.driver):
//   { "type": "appium", "url": "http://127.0.0.1:4723", "os": "ios" | "android",
//     "appId": "com.pocketnotes.dev", "scheme": "pocketnotes", "resetLink": "e2e-reset",
//     "capabilities": { "platformName": "iOS", "appium:automationName": "XCUITest", "appium:udid": "…", "appium:bundleId": "…" } }
// RN maps testID → accessibility identifier (iOS `name`) / resource-id (Android), so elements keep
// the same testIds the plans resolved on the web.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { appiumHub, cloudAppiumCapabilities, redact, sessionPublicUrl, sessionStatusScript, uploadApp, validateCloud, type CloudConfig } from '../cloud/cloud.ts';
import { openTunnel, type Tunnel } from '../cloud/tunnel.ts';
import { iosRole, OVERLAY_ROLES } from '../roles.ts';
import type { Driver, DriverLink, UiElement } from '../types.ts';
import { parseUiAutomator } from './adb.ts';

export interface AppiumOptions {
  url: string;
  os: 'ios' | 'android';
  appId: string;
  scheme: string;
  resetLink?: string; // route opened after relaunch, e.g. "e2e-reset"
  readyTimeoutMs?: number; // how long resetApp waits for the relaunched app's screen to settle (45 s)
  capabilities: Record<string, unknown>;
  /** Run on Sauce Labs / BrowserStack: the vendor hub replaces `url`, the build is uploaded, a tunnel opened. */
  cloud?: CloudConfig;
  /** Session name shown in the cloud dashboard. */
  sessionName?: string;
  /**
   * OS alerts over the app (permission prompts, "Save Password?"): `dismiss` them before each screen
   * read (default), `accept` them, or `leave` them on screen as an `alert` element so steps and
   * @global rules decide ("@global allow notifications when asked").
   */
  systemAlerts?: 'dismiss' | 'accept' | 'leave';
}

interface Node {
  el: UiElement;
  cx: number;
  cy: number;
}

const attr = (s: string, name: string): string =>
  (new RegExp(`\\s${name}="([^"]*)"`).exec(s)?.[1] ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#10;/g, ' ');


/** Parses an XCUITest page source into UiElements with tap centres. Exported for tests. */
export function parseXcuiSource(xml: string): Node[] {
  const out: Node[] = [];
  for (const m of xml.matchAll(/<(XCUIElementType\w+)\b[^>]*>/g)) {
    const tag = m[0];
    const type = m[1] as string;
    if (attr(tag, 'visible') === 'false') continue;
    const name = attr(tag, 'name');
    const label = attr(tag, 'label');
    const value = attr(tag, 'value');
    let role = iosRole(type, attr(tag, 'name'));
    if (/checkbox/i.test(attr(tag, 'traits')) || (type === 'XCUIElementTypeButton' && /^(0|1|checked|unchecked)$/.test(value))) role = role || 'checkbox';
    // Other containers are kept only when they carry a test id (RN Views with testID).
    const testId = name && name !== label ? name : '';
    if (!role && !testId) continue;
    const x = Number(attr(tag, 'x'));
    const y = Number(attr(tag, 'y'));
    const w = Number(attr(tag, 'width'));
    const h = Number(attr(tag, 'height'));
    // Alerts, sheets and popovers carry their title as label; their message is a StaticText inside.
    const el: UiElement = { ref: String(out.length), role: role || 'group', name: label || name, text: role === 'textbox' || OVERLAY_ROLES.has(role) ? (OVERLAY_ROLES.has(role) ? label : '') : label || value };
    if (testId) el.testId = testId;
    if (role === 'textbox') el.value = value;
    if (role === 'checkbox') el.checked = value === '1' || value === 'checked';
    out.push({ el, cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) });
  }
  return out;
}

/** Window containers every Android activity has, also while the app is still loading. */
const WINDOW_CHROME_IDS = new Set(['content', 'action_bar_root', 'decor_content_parent', 'statusBarBackground', 'navigationBarBackground']);

/** An XPath string literal for any text (XPath 1.0 has no escapes; concat() handles both quotes). */
export function xpathLiteral(v: string): string {
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  return `concat(${v.split('"').map((part) => `"${part}"`).join(`, '"', `)})`;
}

export function createAppiumDriver(opts: AppiumOptions): Driver {
  let session: string | undefined;
  let last: Node[] = [];
  if (opts.cloud) validateCloud(opts.cloud);
  const base = (opts.cloud ? appiumHub(opts.cloud) : opts.url).replace(/\/$/, '');
  let tunnel: Tunnel | undefined;
  let cloudLink: string | undefined;
  async function wd<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { value?: unknown };
    const v = json.value as { error?: string; message?: string } | undefined;
    if (!res.ok || (v && typeof v === 'object' && 'error' in v)) {
      const msg = `appium ${method} ${path}: ${v?.message ?? res.status}`;
      throw new Error(opts.cloud?.accessKey ? redact(msg, { username: '', accessKey: opts.cloud.accessKey }) : msg);
    }
    return json.value as T;
  }
  const s = (p: string) => {
    if (!session) throw new Error('appium session not started');
    return `/session/${session}${p}`;
  };
  const exec = (script: string, args: Record<string, unknown> = {}) => wd('POST', s('/execute/sync'), { script, args: [args] });
  const appArg = () => (opts.os === 'ios' ? { bundleId: opts.appId } : { appId: opts.appId });
  const node = (ref: string): Node => {
    const n = last[Number(ref)];
    if (!n) throw new Error(`stale ref ${ref}`);
    return n;
  };
  async function find(n: Node): Promise<string | undefined> {
    if (!n.el.testId) return undefined;
    try {
      // iOS: React Native's testID is the accessibility identifier. Android: it is the view's
      // resource-id (bare "note-add", or "<package>:id/note-add"), which "accessibility id"
      // (content-desc) does not search — so fill never found an input on Android.
      const id = n.el.testId;
      const by =
        opts.os === 'ios'
          ? { using: 'accessibility id', value: id }
          : { using: 'xpath', value: `//*[@resource-id=${xpathLiteral(id)} or @resource-id=${xpathLiteral(`${opts.appId}:id/${id}`)}]` };
      const r = await wd<Record<string, string>>('POST', s('/element'), by);
      return Object.values(r)[0];
    } catch {
      return undefined;
    }
  }
  /** Polls the page source until it shows app elements and two reads in a row agree. */
  async function waitForSettledScreen(timeoutMs = opts.readyTimeoutMs ?? 45_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    let previous = '';
    while (Date.now() < end) {
      const xml = await wd<string>('GET', s('/source')).catch(() => '');
      const nodes = opts.os === 'ios' ? parseXcuiSource(xml) : parseUiAutomator(xml);
      const key = nodes.map((n) => `${n.el.testId ?? ''}|${n.el.name}`).join('\n');
      const appContent = nodes.some((n) => n.el.testId && !WINDOW_CHROME_IDS.has(n.el.testId));
      if (appContent && key === previous) return;
      previous = key;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  const tapAt = (x: number, y: number) =>
    wd('POST', s('/actions'), {
      actions: [
        {
          type: 'pointer',
          id: 'finger',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 60 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  let recordingStem: string | undefined;
  const driver: Driver = {
    platform: 'mobile',
    name: `appium-${opts.os}`,
    async start() {
      let caps = opts.capabilities;
      if (opts.cloud) {
        const c = opts.cloud;
        if (!c.app) throw new Error(`${c.provider}: cloud.app is required (a build to upload, or storage:… / bs://…)`);
        const app = await uploadApp(c, c.app);
        tunnel = await openTunnel(c);
        caps = cloudAppiumCapabilities(c, caps, {
          app,
          ...(tunnel ? { tunnelName: tunnel.name } : {}),
          ...(opts.sessionName ? { sessionName: opts.sessionName } : {}),
        });
      }
      try {
        const r = await wd<{ sessionId: string }>('POST', '/session', { capabilities: { alwaysMatch: caps, firstMatch: [{}] } });
        session = r.sessionId;
      } catch (e) {
        await tunnel?.stop();
        tunnel = undefined;
        throw e;
      }
      if (opts.cloud) cloudLink = await sessionPublicUrl(opts.cloud, session);
    },
    async stop(outcome) {
      if (session && opts.cloud && outcome) {
        const reason = `${outcome.scenarios - outcome.failed}/${outcome.scenarios} scenarios passed`;
        await exec(sessionStatusScript(opts.cloud, outcome.passed, reason)).catch(() => undefined);
      }
      if (session) await wd('DELETE', s('')).catch(() => undefined);
      session = undefined;
      await tunnel?.stop();
      tunnel = undefined;
    },
    async links(): Promise<DriverLink[]> {
      return cloudLink && opts.cloud ? [{ label: `${opts.cloud.provider} session (video, logs)`, url: cloudLink }] : [];
    },
    async resetApp() {
      await exec('mobile: terminateApp', appArg()).catch(() => undefined);
      await exec('mobile: activateApp', appArg());
      // A link sent while the app is still starting (a debug build loads its JavaScript first) is
      // dropped by the OS on Android, so the reset never happened: wait for a settled screen.
      await waitForSettledScreen();
      if (opts.resetLink) {
        await driver.navigate?.(opts.resetLink);
        await waitForSettledScreen();
      }
    },
    async openRoute() {
      throw new Error('appium driver opens routes through navigate(target)');
    },
    async navigate(target) {
      const url = /^[a-z][\w+.-]*:\/\//i.test(target) ? target : `${opts.scheme}://${target}`;
      try {
        await exec('mobile: deepLink', opts.os === 'ios' ? { url, bundleId: opts.appId } : { url, package: opts.appId });
      } catch (e) {
        // Some clouds do not expose `mobile: deepLink`; WebDriver's navigate opens the URL through the OS.
        if (!opts.cloud) throw e;
        await wd('POST', s('/url'), { url });
      }
    },
    async snapshot() {
      // System sheets ("Save Password?", permission prompts) cover the app; a real user would close
      // them, so the driver does too before reading the screen (found on iOS after a sign-in).
      const mode = opts.systemAlerts ?? 'dismiss';
      if (mode !== 'leave') {
        try {
          await wd('GET', s('/alert/text'));
          await wd('POST', s(mode === 'accept' ? '/alert/accept' : '/alert/dismiss'), {});
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          // no alert
        }
      }
      const xml = await wd<string>('GET', s('/source'));
      last = opts.os === 'ios' ? parseXcuiSource(xml) : parseUiAutomator(xml);
      return last.map((n) => n.el);
    },
    async tap(ref) {
      const n = node(ref);
      const id = await find(n);
      if (id) await wd('POST', s(`/element/${id}/click`), {});
      else await tapAt(n.cx, n.cy);
    },
    async fill(ref, text) {
      const n = node(ref);
      const id = await find(n);
      if (!id) throw new Error(`appium: no accessibility id for ${n.el.name}; add a testID to the input`);
      await wd('POST', s(`/element/${id}/clear`), {});
      await wd('POST', s(`/element/${id}/value`), { text });
    },
    async screenshot(path) {
      const b64 = await wd<string>('GET', s('/screenshot'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(b64, 'base64'));
    },
    async startRecording(stem) {
      await wd('POST', s('/appium/start_recording_screen'), { options: { videoType: 'h264', timeLimit: '600' } });
      recordingStem = stem;
    },
    async stopRecording() {
      const b64 = await wd<string>('POST', s('/appium/stop_recording_screen'), {});
      if (!b64 || !recordingStem) return undefined;
      const file = `${recordingStem}.mp4`;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(b64, 'base64'));
      recordingStem = undefined;
      return file;
    },
  };
  if (opts.cloud) {
    // The vendor records the whole session (linked from the report); its Appium recording endpoints
    // are not available everywhere.
    delete driver.startRecording;
    delete driver.stopRecording;
  }
  return driver;
}
