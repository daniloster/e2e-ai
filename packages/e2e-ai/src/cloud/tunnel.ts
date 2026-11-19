// Tunnels that let cloud devices and browsers reach the machine running the tests (the test-data API,
// the web app, our RN bridge): Sauce Connect 5 (`sc`) and BrowserStack Local (`BrowserStackLocal`).
// `cloud.tunnel: true` starts one for the run; a string names a tunnel already running (CI usually
// starts it in its own step). The binaries are the vendors' own; install them on the runner.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { credentials, redact, type CloudConfig } from './cloud.ts';

const run = promisify(execFile);

export interface Tunnel {
  /** Sauce `tunnelName` / BrowserStack `localIdentifier`. */
  name: string;
  /** Whether this run started it (and so stops it). */
  owned: boolean;
  stop(): Promise<void>;
}

/** Sauce Connect names its regions without the data-center number: us-west-1 → us-west. */
export const sauceConnectRegion = (region = 'us-west-1') => region.replace(/-\d+$/, '');

export const newTunnelName = () => `e2e-ai-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

export interface TunnelDeps {
  spawn?: typeof spawn;
  exec?: (bin: string, args: string[]) => Promise<{ stdout: string }>;
  timeoutMs?: number;
  /** Tunnel name to use (default: a fresh unique one). */
  name?: string;
}

export async function openTunnel(c: CloudConfig, deps: TunnelDeps = {}): Promise<Tunnel | undefined> {
  if (!c.tunnel) return undefined;
  if (typeof c.tunnel === 'string') return { name: c.tunnel, owned: false, stop: async () => undefined };
  const cred = credentials(c);
  const name = deps.name ?? newTunnelName();
  const timeoutMs = deps.timeoutMs ?? 120_000;
  if (c.provider === 'saucelabs') {
    const bin = c.tunnelBinary ?? 'sc';
    const args = ['run', '--username', cred.username, '--access-key', cred.accessKey, '--region', sauceConnectRegion(c.region), '--tunnel-name', name];
    const proc = (deps.spawn ?? spawn)(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcess;
    await waitForLine(proc, /you may start your tests/i, timeoutMs, `Sauce Connect (${bin})`, cred);
    return {
      name,
      owned: true,
      stop: () =>
        new Promise<void>((resolve) => {
          if (proc.exitCode !== null) return resolve();
          proc.once('exit', () => resolve());
          proc.kill('SIGINT');
          setTimeout(resolve, 15_000);
        }),
    };
  }
  const bin = c.tunnelBinary ?? 'BrowserStackLocal';
  const exec = deps.exec ?? ((b: string, a: string[]) => run(b, a, { timeout: timeoutMs }));
  let out: string;
  try {
    out = (await exec(bin, ['--key', cred.accessKey, '--local-identifier', name, '--daemon', 'start', '--force-local'])).stdout;
  } catch (e) {
    throw new Error(redact(`BrowserStack Local (${bin}) did not start: ${e instanceof Error ? e.message : String(e)}`, cred));
  }
  const state = /"state"\s*:\s*"(\w+)"/.exec(out)?.[1];
  if (state !== 'connected') throw new Error(redact(`BrowserStack Local did not connect: ${out.slice(0, 300)}`, cred));
  return {
    name,
    owned: true,
    stop: async () => {
      await exec(bin, ['--key', cred.accessKey, '--local-identifier', name, '--daemon', 'stop']).catch(() => undefined);
    },
  };
}

function waitForLine(proc: ChildProcess, ready: RegExp, timeoutMs: number, what: string, cred: { accessKey: string; username: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    let tail = '';
    const done = (e?: Error) => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      if (e) {
        proc.kill('SIGINT');
        reject(e);
      } else resolve();
    };
    const onData = (b: Buffer) => {
      tail = (tail + b.toString()).slice(-4000);
      if (ready.test(tail)) done();
    };
    const timer = setTimeout(() => done(new Error(redact(`${what} not up after ${timeoutMs / 1000}s:\n${tail.slice(-800)}`, cred))), timeoutMs);
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.once('error', (e) => done(new Error(`${what} could not start: ${e.message} (is it installed and on PATH?)`)));
    proc.once('exit', (code) => done(new Error(redact(`${what} exited (${code}) before it was up:\n${tail.slice(-800)}`, cred))));
  });
}
