#!/usr/bin/env node
// Runs every cloud target of e2e/e2e-ai.config.json against local stand-ins for Sauce Labs and
// BrowserStack, so the cloud integration is checked end to end without accounts:
//   - mobile (Appium, our RN bridge): a fake vendor API + hub (packages/e2e-ai/src/cloud/fakeCloud.ts)
//     that takes the upload, checks the vendor credentials and options, records the session status,
//     and forwards WebDriver to the local Appium on the local emulator (the e2e build is installed
//     from the "upload", fresh, every run);
//   - web, BrowserStack style: Playwright run-servers (remote Playwright, like cdp.browserstack.com);
//   - web, Sauce style: the fake hub answers like Selenium Grid 4 (Chrome + se:cdp);
//   - Maestro: flows compiled from the reviewed plans (--compile-only; running them needs maestro-runner).
// Needs: Appium on :4723 with UiAutomator2, an Android emulator, the e2e APK
// (cd apps/mobile && E2E_API_URL=http://10.0.2.2:4010 E2E_BRIDGE_URL=ws://10.0.2.2:4011 npm run android:build:e2e),
// the fixture API (:4010) and the web app (:5180).
//   node scripts/fake-cloud-check.ts [--only <target substring>]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { startFakeCloud } from '../packages/e2e-ai/src/cloud/fakeCloud.ts';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const configPath = join(root, 'e2e/e2e-ai.config.json');
const fakeConfig = join(root, 'e2e/.fake-cloud.config.json');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const adb = join(process.env.ANDROID_HOME ?? join(process.env.HOME ?? '', 'Library/Android/sdk'), 'platform-tools/adb');

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

for (const [what, url] of [
  ['Appium (:4723)', 'http://127.0.0.1:4723/status'],
  ['fixture API (:4010)', 'http://127.0.0.1:4010/health'],
  ['web app (:5180)', 'http://localhost:5180/app.html'],
] as const) {
  if (!(await up(url))) throw new Error(`${what} is not running`);
}
const apk = join(root, 'apps/mobile/android/app/build/outputs/apk/e2e/app-e2e.apk');
if (!existsSync(apk)) throw new Error(`no e2e APK at ${apk}`);

const procs: ChildProcess[] = [];
const require = createRequire(import.meta.url);
const pw163 = join(dirname(require.resolve('playwright/package.json', { paths: [root] })), 'cli.js');
const mcpDir = dirname(require.resolve('@playwright/mcp/package.json', { paths: [root] }));
const pwMcp = join(mcpDir, 'node_modules/playwright/cli.js');
procs.push(spawn('node', [pw163, 'run-server', '--port', '3333', '--host', '127.0.0.1'], { stdio: 'ignore' }));
procs.push(spawn('node', [existsSync(pwMcp) ? pwMcp : pw163, 'run-server', '--port', '3334', '--host', '127.0.0.1'], { stdio: 'ignore' }));
const fake = await startFakeCloud({ port: 4800, appium: 'http://127.0.0.1:4723' });
await new Promise((r) => setTimeout(r, 3000));

// The real config, with each cloud target pointed at the stand-ins.
const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { targets: Record<string, { platform: string; driver?: { type?: string }; cloud?: Record<string, unknown> }> };
const targets = Object.entries(cfg.targets).filter(([n, t]) => t.cloud && (!only || n.includes(only)));
for (const [, t] of targets) {
  const c = t.cloud as Record<string, unknown>;
  const fakeCreds = { username: 'fake-user', accessKey: 'fake-key-SECRET', tunnel: 'fake-tunnel', api: fake.url };
  if (t.platform === 'mobile') Object.assign(c, fakeCreds, { hub: `${fake.url}/wd/hub` });
  else if (c.provider === 'browserstack') Object.assign(c, fakeCreds, { hub: t.driver?.type === 'playwright-mcp' ? 'ws://127.0.0.1:3334/' : 'ws://127.0.0.1:3333/' });
  else Object.assign(c, fakeCreds, { hub: `${fake.url}/wd/hub/` });
}
writeFileSync(fakeConfig, JSON.stringify(cfg, null, 2));

const cli = join(root, 'packages/e2e-ai-cli/src/cli.ts');
const results: { target: string; how: string; result: string; ok: boolean }[] = [];
/** Runs a command without blocking this process: the fake cloud lives here and must keep answering. */
function exec(cmd: string, args: string[], env: Record<string, string>): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (b: Buffer) => (out += b.toString()));
    p.stderr.on('data', (b: Buffer) => (out += b.toString()));
    const timer = setTimeout(() => p.kill(), 30 * 60_000);
    p.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
}

async function run(target: string, how: string, cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = await exec(cmd, args, env);
  const out = r.out;
  const m = /(\d+)\/(\d+) scenarios passed/.exec(out) ?? /(\d+) passed/.exec(out);
  const summary = m ? m[0] : (out.match(/Error[^\n]*/)?.[0] ?? `exit ${r.status}`);
  const ok = r.status === 0 && !!m && (m[2] === undefined || m[1] === m[2]);
  if (out.includes('fake-key-SECRET')) results.push({ target, how, result: 'ACCESS KEY PRINTED', ok: false });
  results.push({ target, how, result: summary, ok });
  console.log(`${ok ? '✓' : '✗'} ${target.padEnd(34)} ${how.padEnd(22)} ${summary}`);
  if (!ok) console.log(out.split('\n').filter((l) => /✗|!|Error|error/.test(l)).slice(0, 6).map((l) => `      ${l.trim()}`).join('\n'));
}

try {
  for (const [name, t] of targets) {
    if (t.platform === 'mobile') spawnSync(adb, ['uninstall', 'com.pocketnotes.e2e'], { stdio: 'ignore' });
    const maestro = t.driver?.type === 'maestro';
    await run(name, maestro ? 'compiled flows' : 'replay', 'node', [cli, 'run', '--config', fakeConfig, '--target', name, '--replay', '--no-ai-report', '--video', 'none', ...(maestro ? ['--compile-only'] : [])]);
    // Playwright Test runs the same web targets through its own runner.
    if (t.platform === 'web' && t.driver?.type === 'mcp') {
      await run(name, 'Playwright Test', 'npx', ['playwright', 'test', '-c', 'e2e/playwright'], { E2E_REPLAY: '1', E2E_CONFIG: fakeConfig, E2E_TARGET: name });
    }
  }
} finally {
  procs.forEach((p) => p.kill());
  fake.server.close();
  rmSync(fakeConfig, { force: true });
}

const log = fake.log;
const mobileRuns = targets.filter(([, t]) => t.platform === 'mobile' && t.driver?.type !== 'maestro').length;
const sauceWeb = targets.filter(([, t]) => t.platform === 'web' && t.cloud?.provider === 'saucelabs').length;
const checks = [
  ['every mobile run uploaded its build, with credentials', log.uploads.length >= Math.min(mobileRuns, 1) && log.uploads.every((u) => u.auth)],
  ['every mobile run opened a session with vendor credentials and options', log.sessions.length >= mobileRuns && log.sessions.every((s) => s.caps['sauce:options'] || s.caps['bstack:options'])],
  ['every mobile session was marked passed/failed', log.sessions.every((s) => log.statuses.some((x) => x.session === s.id))],
  ['Sauce-style web runs went through the grid', sauceWeb === 0 || log.browsers.length >= sauceWeb],
  ['the stand-in rejected nothing', log.rejected.length === 0],
] as const;
console.log(`\nvendor side: ${log.uploads.length} uploads, ${log.sessions.length} mobile sessions, ${log.browsers.length} Sauce-style browser sessions, ${log.statuses.length} status updates`);
for (const [what, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${what}`);
if (log.rejected.length) console.log(log.rejected);
process.exit(results.every((r) => r.ok) && checks.every(([, ok]) => ok) ? 0 : 1);
