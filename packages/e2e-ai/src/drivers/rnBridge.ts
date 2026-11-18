// Mobile driver, gray-box: a WebSocket server the app's dev-only e2e bridge connects to
// (apps/mobile/src/testing/e2eBridge.ts). The app answers `snapshot` from its React fiber tree and
// performs `tap`/`fill` by invoking the same props a real touch would (onPress, onChangeText), like
// React Native Testing Library's fireEvent — but in the real app, on a simulator or device, against
// the real API. No extra tooling (Maestro/Appium/Detox) needed; not pixel-level (see investigation).
import { execFile, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';

import type { Driver, UiElement } from '../types.ts';

export interface RnBridgeOptions {
  port?: number; // default 4011
  /** Command that (re)launches the app, e.g. ['xcrun','simctl','launch','booted','com.x.dev']. */
  launch?: readonly string[];
  connectTimeoutMs?: number;
  /** iOS simulator UDID (or "booted") for screenshots/video via `xcrun simctl io`. */
  simulator?: string;
  /** Android device/emulator: screenshots via `adb exec-out screencap`, video via `adb shell screenrecord`. */
  android?: { serial?: string };
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
}

export function createRnBridgeDriver(opts: RnBridgeOptions = {}): Driver {
  const port = opts.port ?? 4011;
  let wss: WebSocketServer | undefined;
  let socket: WebSocket | undefined;
  let seq = 0;
  const pending = new Map<number, Pending>();
  let waiters: Array<(s: WebSocket) => void> = [];
  let recorder: { proc: ReturnType<typeof spawn>; file: string; remote?: string; adbArgs?: string[] } | undefined;

  const connected = (timeoutMs: number): Promise<WebSocket> =>
    socket && socket.readyState === socket.OPEN
      ? Promise.resolve(socket)
      : new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(`app did not connect to ws://localhost:${port} in ${timeoutMs}ms`)), timeoutMs);
          waiters.push((s) => {
            clearTimeout(t);
            resolve(s);
          });
        });

  async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const s = await connected(opts.connectTimeoutMs ?? 60_000);
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`bridge ${op} timed out`));
      }, 15_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      s.send(JSON.stringify({ id, op, args }));
    });
  }

  return {
    platform: 'mobile',
    name: 'rn-bridge',
    async start() {
      wss = new WebSocketServer({ port, host: '0.0.0.0' });
      wss.on('connection', (ws) => {
        socket = ws;
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw)) as { id: number; ok: boolean; result?: unknown; error?: string };
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error ?? 'bridge error'));
        });
        const w = waiters;
        waiters = [];
        for (const f of w) f(ws);
      });
      if (opts.launch && opts.launch.length > 0) {
        const [cmd, ...args] = opts.launch;
        await new Promise<void>((resolve, reject) => {
          const p = spawn(cmd as string, args, { stdio: 'ignore' });
          p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`launch exited ${code}`))));
          p.on('error', reject);
        });
      }
      await connected(opts.connectTimeoutMs ?? 120_000);
    },
    async stop() {
      for (const c of wss?.clients ?? []) c.terminate();
      await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
    },
    async resetApp() {
      await call('reset');
    },
    async openRoute(route, params) {
      await call('openRoute', { route, params: params ?? {} });
    },
    snapshot: () => call<UiElement[]>('snapshot'),
    async tap(ref) {
      await call('tap', { ref });
    },
    async fill(ref, text) {
      await call('fill', { ref, text });
    },
    async navigate(target) {
      const [route, query = ''] = target.split('?');
      await call('openRoute', { route, params: Object.fromEntries(new URLSearchParams(query)) });
    },
    async startRecording(stem) {
      if (opts.android) {
        const adbArgs = opts.android.serial ? ['-s', opts.android.serial] : [];
        const remote = '/sdcard/e2e-ai-video.mp4';
        const proc = spawn('adb', [...adbArgs, 'shell', 'screenrecord', remote], { stdio: ['ignore', 'ignore', 'pipe'] });
        recorder = { proc, file: `${stem}.mp4`, remote, adbArgs };
        await new Promise((r) => setTimeout(r, 800));
        return;
      }
      if (!opts.simulator) throw new Error('no simulator for video');
      mkdirSync(dirname(stem), { recursive: true });
      const file = `${stem}.mp4`;
      const proc = spawn('xcrun', ['simctl', 'io', opts.simulator, 'recordVideo', '--codec=h264', '--force', file], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      // simctl prints "Recording started" on stderr once frames flow.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 3000);
        proc.stderr.on('data', (d: Buffer) => {
          if (/started/i.test(String(d))) {
            clearTimeout(t);
            resolve();
          }
        });
        proc.on('exit', () => resolve());
      });
      recorder = { proc, file };
    },
    async stopRecording() {
      if (!recorder) return undefined;
      const { proc, file, remote, adbArgs } = recorder;
      recorder = undefined;
      // SIGINT lets simctl/screenrecord finish the MP4 (SIGKILL leaves an unplayable file).
      if (remote) await promisify(execFile)('adb', [...(adbArgs ?? []), 'shell', 'pkill', '-INT', 'screenrecord']).catch(() => undefined);
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
        proc.kill('SIGINT');
        setTimeout(resolve, 10_000);
      });
      if (remote) {
        mkdirSync(dirname(file), { recursive: true });
        await promisify(execFile)('adb', [...(adbArgs ?? []), 'pull', remote, file]);
      }
      return file;
    },
    async screenshot(path) {
      if (opts.android) {
        const { stdout } = await promisify(execFile)('adb', [...(opts.android.serial ? ['-s', opts.android.serial] : []), 'exec-out', 'screencap', '-p'], {
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
        });
        mkdirSync(dirname(path), { recursive: true });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(path, stdout as unknown as Buffer);
        return;
      }
      if (!opts.simulator) throw new Error('no simulator for screenshots');
      mkdirSync(dirname(path), { recursive: true });
      await promisify(execFile)('xcrun', ['simctl', 'io', opts.simulator, 'screenshot', path]);
    },
  };
}
