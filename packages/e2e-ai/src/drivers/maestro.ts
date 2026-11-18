// Mobile driver through Maestro (CLI). The engine reads Maestro's view hierarchy and performs every
// action as a one-command Maestro flow (`tapOn`, `eraseText`, `inputText`, `openLink`, `stopApp`,
// `launchApp`, `takeScreenshot`), so Maestro does all device interaction on iOS and Android.
// Videos use the platform recorder (simctl / adb), because a Maestro recording cannot span flows.
//
// Config: { "type": "maestro", "os": "ios" | "android", "device": "<udid|serial>", "appId": "com.pocketnotes.dev",
//           "scheme": "pocketnotes", "resetLink": "e2e-reset", "maestro": "maestro" }
// Every action starts the Maestro CLI (a JVM): expect ~1–3 s per action. `maestro mcp` would avoid
// that; this adapter sticks to the documented CLI.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { Driver, UiElement } from '../types.ts';

const run = promisify(execFile);

export interface MaestroOptions {
  os: 'ios' | 'android';
  device?: string;
  appId: string;
  scheme: string;
  resetLink?: string;
  maestro?: string; // CLI path
}

interface Node {
  el: UiElement;
  cx: number;
  cy: number;
}

interface MaestroNode {
  attributes?: Record<string, string>;
  children?: MaestroNode[];
}

const bounds = (b: string | undefined) => {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b ?? '');
  return m ? (m.slice(1).map(Number) as [number, number, number, number]) : undefined;
};

/** Maestro `hierarchy` JSON → UiElements with tap centres. Exported for tests. */
export function parseMaestroHierarchy(json: string): Node[] {
  const root = JSON.parse(json) as MaestroNode;
  const out: Node[] = [];
  const visit = (n: MaestroNode) => {
    const a = n.attributes ?? {};
    const text = a.text ?? '';
    const label = a.accessibilityText ?? a['content-desc'] ?? '';
    const rid = (a['resource-id'] ?? '').replace(/^.*:id\//, '');
    const cls = a.class ?? a.elementType ?? '';
    const b = bounds(a.bounds);
    const checkable = a.checked !== undefined && a.checkable === 'true';
    const role = /EditText|TextField|textField/i.test(cls)
      ? 'textbox'
      : checkable || /checkbox|switch/i.test(cls)
        ? 'checkbox'
        : a.clickable === 'true'
          ? 'button'
          : text
            ? 'text'
            : '';
    if (b && (role || rid) && a.enabled !== 'false') {
      const el: UiElement = { ref: String(out.length), role: role || 'group', name: label || text, text };
      if (rid) el.testId = rid;
      if (role === 'textbox') el.value = text;
      if (role === 'checkbox') el.checked = a.checked === 'true';
      out.push({ el, cx: Math.round((b[0] + b[2]) / 2), cy: Math.round((b[1] + b[3]) / 2) });
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}

const yamlStr = (s: string) => JSON.stringify(s); // JSON strings are valid YAML scalars

export function createMaestroDriver(opts: MaestroOptions): Driver {
  const bin = opts.maestro ?? 'maestro';
  const dev = opts.device ? ['--device', opts.device] : [];
  const dir = mkdtempSync(join(tmpdir(), 'e2e-ai-maestro-'));
  let last: Node[] = [];
  let seq = 0;
  let recorder: { proc: ChildProcess; file: string; remote?: string } | undefined;
  async function flow(commands: string[]): Promise<void> {
    const file = join(dir, `step-${++seq}.yaml`);
    writeFileSync(file, `appId: ${opts.appId}\n---\n${commands.map((c) => `- ${c}`).join('\n')}\n`);
    await run(bin, [...dev, 'test', file], { maxBuffer: 16 * 1024 * 1024 });
  }
  const node = (ref: string) => {
    const n = last[Number(ref)];
    if (!n) throw new Error(`stale ref ${ref}`);
    return n;
  };
  const target = (n: Node) => (n.el.testId ? `tapOn:\n    id: ${yamlStr(n.el.testId)}` : `tapOn:\n    point: "${n.cx},${n.cy}"`);
  const driver: Driver = {
    platform: 'mobile',
    name: `maestro-${opts.os}`,
    async start() {
      await run(bin, ['--version']);
    },
    async stop() {},
    async resetApp() {
      await flow(['stopApp', 'launchApp']);
      if (opts.resetLink) await driver.navigate?.(opts.resetLink);
    },
    async openRoute() {
      throw new Error('maestro driver opens routes through navigate(target)');
    },
    async navigate(t) {
      const url = /^[a-z][\w+.-]*:\/\//i.test(t) ? t : `${opts.scheme}://${t}`;
      await flow([`openLink: ${yamlStr(url)}`]);
    },
    async snapshot() {
      const { stdout } = await run(bin, [...dev, 'hierarchy'], { maxBuffer: 64 * 1024 * 1024 });
      last = parseMaestroHierarchy(stdout.slice(stdout.indexOf('{')));
      return last.map((n) => n.el);
    },
    async tap(ref) {
      await flow([target(node(ref))]);
    },
    async fill(ref, text) {
      const n = node(ref);
      await flow([target(n), `eraseText: ${Math.max(20, (n.el.value ?? '').length + 5)}`, `inputText: ${yamlStr(text)}`]);
    },
    async screenshot(path) {
      mkdirSync(dirname(path), { recursive: true });
      await flow([`takeScreenshot: ${yamlStr(path.replace(/\.png$/, ''))}`]);
    },
    async startRecording(stem) {
      mkdirSync(dirname(stem), { recursive: true });
      const file = `${stem}.mp4`;
      if (opts.os === 'ios') {
        const proc = spawn('xcrun', ['simctl', 'io', opts.device ?? 'booted', 'recordVideo', '--codec=h264', '--force', file], { stdio: 'ignore' });
        recorder = { proc, file };
      } else {
        const remote = '/sdcard/e2e-ai-video.mp4';
        const proc = spawn('adb', [...(opts.device ? ['-s', opts.device] : []), 'shell', 'screenrecord', remote], { stdio: 'ignore' });
        recorder = { proc, file, remote };
      }
      await new Promise((r) => setTimeout(r, 800));
    },
    async stopRecording() {
      if (!recorder) return undefined;
      const r = recorder;
      recorder = undefined;
      await new Promise<void>((resolve) => {
        r.proc.on('exit', () => resolve());
        r.proc.kill('SIGINT');
        setTimeout(resolve, 8000);
      });
      if (r.remote) await run('adb', [...(opts.device ? ['-s', opts.device] : []), 'pull', r.remote, r.file]);
      return r.file;
    },
  };
  return driver;
}
