// Mobile driver, black-box, Android only: `uiautomator dump` for the real view hierarchy, `input tap`
// / `input text` for real touches. React Native maps testID → resource-id and accessibilityLabel →
// content-desc on Android. Zero extra installs beyond platform-tools.
// STATUS: written for the spike, NOT yet validated on a device/emulator (none was available).
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import type { Driver, UiElement } from '../types.ts';

const run = promisify(execFile);

export interface AdbDriverOptions {
  appId: string;
  serial?: string;
  /** route name → deep link URL, e.g. { notes: 'pocketnotes://notes' } */
  deepLinks: Record<string, string>;
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
    .replace(/&gt;/g, '>');

/** Parses `uiautomator dump` XML into UiElements with tap centres. Exported for tests. */
export function parseUiAutomator(xml: string): Node[] {
  const out: Node[] = [];
  // `uiautomator dump` writes <node class="…">; Appium (UiAutomator2) names each element after its
  // class (<android.widget.EditText …>). Both carry the same attributes, so read either.
  for (const m of xml.matchAll(/<(?:node|[A-Za-z_][\w$]*(?:\.[\w$]+)+)\b[^>]*\bbounds="[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const cls = attr(tag, 'class');
    const text = attr(tag, 'text');
    const desc = attr(tag, 'content-desc');
    const rid = attr(tag, 'resource-id');
    const clickable = attr(tag, 'clickable') === 'true';
    const checkable = attr(tag, 'checkable') === 'true';
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(tag, 'bounds'));
    if (!b) continue;
    const role = /EditText/.test(cls) ? 'textbox' : checkable ? 'checkbox' : clickable ? 'button' : text ? 'text' : '';
    if (!role && !rid) continue;
    const el: UiElement = { ref: String(out.length), role: role || 'group', name: desc || text, text };
    if (rid) el.testId = rid.replace(/^.*:id\//, '');
    if (checkable) el.checked = attr(tag, 'checked') === 'true';
    if (role === 'textbox') el.value = text;
    const [x1, y1, x2, y2] = b.slice(1).map(Number) as [number, number, number, number];
    out.push({ el, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) });
  }
  return out;
}

export function createAdbDriver(opts: AdbDriverOptions): Driver {
  const adb = (...args: string[]) => run('adb', [...(opts.serial ? ['-s', opts.serial] : []), ...args]);
  let last: Node[] = [];
  let recording: { proc: { kill(): void }; remote: string; local: string } | undefined;
  const node = (ref: string): Node => {
    const n = last[Number(ref)];
    if (!n) throw new Error(`stale ref ${ref}`);
    return n;
  };
  return {
    platform: 'mobile',
    name: 'adb-uiautomator',
    async start() {
      await adb('get-state');
    },
    async stop() {},
    async resetApp() {
      await adb('shell', 'pm', 'clear', opts.appId);
      await adb('shell', 'monkey', '-p', opts.appId, '-c', 'android.intent.category.LAUNCHER', '1');
    },
    async openRoute(route, params) {
      const base = opts.deepLinks[route];
      if (!base) throw new Error(`route ${route} has no deep link`);
      const q = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
      await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${base}${q}'`, opts.appId);
    },
    async snapshot() {
      await adb('shell', 'uiautomator', 'dump', '/sdcard/e2e-ui.xml');
      const { stdout } = await adb('shell', 'cat', '/sdcard/e2e-ui.xml');
      last = parseUiAutomator(stdout);
      return last.map((n) => n.el);
    },
    async tap(ref) {
      const n = node(ref);
      await adb('shell', 'input', 'tap', String(n.cx), String(n.cy));
    },
    async fill(ref, text) {
      const n = node(ref);
      await adb('shell', 'input', 'tap', String(n.cx), String(n.cy));
      await adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
      for (let i = 0; i < (n.el.value ?? '').length; i++) await adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
      await adb('shell', 'input', 'text', `'${text.replace(/ /g, '%s').replace(/'/g, "\\'")}'`);
    },
    async startRecording(stem) {
      // STATUS: unvalidated (no device). screenrecord stops at 3 min.
      const remote = '/sdcard/e2e-ai-video.mp4';
      const { spawn } = await import('node:child_process');
      const proc = spawn('adb', [...(opts.serial ? ['-s', opts.serial] : []), 'shell', 'screenrecord', remote]);
      recording = { proc, remote, local: `${stem}.mp4` };
    },
    async stopRecording() {
      if (!recording) return undefined;
      const r = recording;
      recording = undefined;
      await adb('shell', 'pkill', '-INT', 'screenrecord').catch(() => undefined);
      await new Promise((res) => setTimeout(res, 1000));
      r.proc.kill();
      mkdirSync(dirname(r.local), { recursive: true });
      await adb('pull', r.remote, r.local);
      return r.local;
    },
    async screenshot(path) {
      const { stdout } = await run('adb', [...(opts.serial ? ['-s', opts.serial] : []), 'exec-out', 'screencap', '-p'], {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
      });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, stdout as unknown as Buffer);
    },
  };
}
