import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppiumDriver } from '../drivers/appium.ts';
import { cloudServerSpec } from '../drivers/playwrightMcp.ts';
import {
  apiBase,
  appiumHub,
  cloudAppiumCapabilities,
  credentials,
  redact,
  remoteBrowser,
  sessionStatusScript,
  sessionUrl,
  uploadApp,
  validateCloud,
  type CloudConfig,
} from './cloud.ts';
import { openTunnel, sauceConnectRegion } from './tunnel.ts';

const SAUCE: CloudConfig = { provider: 'saucelabs', username: 'sam', accessKey: 'sauce-key-123' };
const BS: CloudConfig = { provider: 'browserstack', username: 'bea', accessKey: 'bs-key-456' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloud config', () => {
  it('takes credentials from the config or the environment, and names the variables when missing', () => {
    expect(credentials(SAUCE)).toEqual({ username: 'sam', accessKey: 'sauce-key-123' });
    expect(credentials({ provider: 'browserstack' }, { BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' })).toEqual({ username: 'u', accessKey: 'k' });
    expect(() => credentials({ provider: 'saucelabs' }, {})).toThrow('set SAUCE_USERNAME and SAUCE_ACCESS_KEY');
  });

  it('knows each vendor hub and REST API, per Sauce data center, with overrides', () => {
    expect(appiumHub(SAUCE)).toBe('https://ondemand.us-west-1.saucelabs.com/wd/hub');
    expect(appiumHub({ ...SAUCE, region: 'eu-central-1' })).toBe('https://ondemand.eu-central-1.saucelabs.com/wd/hub');
    expect(apiBase({ ...SAUCE, region: 'us-east-4' })).toBe('https://api.us-east-4.saucelabs.com');
    expect(appiumHub(BS)).toBe('https://hub.browserstack.com/wd/hub');
    expect(apiBase(BS)).toBe('https://api-cloud.browserstack.com');
    expect(appiumHub({ ...BS, hub: 'http://127.0.0.1:4800/wd/hub/' })).toBe('http://127.0.0.1:4800/wd/hub');
    expect(() => validateCloud({ provider: 'lambdatest' as never })).toThrow('saucelabs, browserstack');
    expect(() => validateCloud({ ...SAUCE, region: 'mars' })).toThrow('not a Sauce Labs data center');
    expect(sauceConnectRegion('eu-central-1')).toBe('eu-central');
  });

  it('never leaks the access key in messages', () => {
    expect(redact('url https://sam:sauce-key-123@x and sauce-key-123', credentials(SAUCE))).toBe('url https://sam:***@x and ***');
  });

  it('turns local Appium capabilities into each vendor’s, dropping device-local ones', () => {
    const local = { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': 'emulator-5554', 'appium:appPackage': 'com.x.e2e', 'appium:noReset': true };
    const sauce = cloudAppiumCapabilities({ ...SAUCE, device: 'Google Pixel.*', platformVersion: '14', build: 'ci-7' }, local, { app: 'storage:abc', tunnelName: 't1', sessionName: 'e2e-ai android' });
    expect(sauce).toEqual({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.x.e2e',
      'appium:noReset': true,
      'appium:app': 'storage:abc',
      'appium:deviceName': 'Google Pixel.*',
      'appium:platformVersion': '14',
      'sauce:options': { username: 'sam', accessKey: 'sauce-key-123', build: 'ci-7', name: 'e2e-ai android', tunnelName: 't1', appiumVersion: 'latest' },
    });
    const bs = cloudAppiumCapabilities({ ...BS, device: 'Google Pixel 8', platformVersion: '14.0', project: 'notes' }, local, { app: 'bs://x', tunnelName: 't2' });
    expect(bs['appium:udid']).toBeUndefined();
    expect(bs['bstack:options']).toEqual({ userName: 'bea', accessKey: 'bs-key-456', deviceName: 'Google Pixel 8', osVersion: '14.0', projectName: 'notes', local: true, localIdentifier: 't2' });
  });

  it('marks sessions and links dashboards the way each vendor documents', () => {
    expect(sessionStatusScript(SAUCE, false, 'x')).toBe('sauce:job-result=failed');
    expect(JSON.parse(sessionStatusScript(BS, true, '11/11').replace('browserstack_executor: ', ''))).toEqual({
      action: 'setSessionStatus',
      arguments: { status: 'passed', reason: '11/11' },
    });
    expect(sessionUrl(SAUCE, 'abc')).toBe('https://app.saucelabs.com/tests/abc');
    expect(sessionUrl({ ...SAUCE, region: 'eu-central-1' }, 'abc')).toBe('https://app.eu-central-1.saucelabs.com/tests/abc');
  });
});

describe('app upload', () => {
  it('posts the build once per content to each vendor’s storage and returns the appium:app reference', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-cloud-'));
    const apk = join(dir, 'app-e2e.apk');
    writeFileSync(apk, 'APK-BYTES');
    const calls: { url: string; fields: string[]; auth: string }[] = [];
    const fake = (async (url: string, init: { headers: Record<string, string>; body: FormData }) => {
      calls.push({ url, fields: [...init.body.keys()], auth: init.headers.authorization ?? '' });
      const body = url.includes('saucelabs') ? { item: { id: 'f-1' } } : { app_url: 'bs://a1b2' };
      return new Response(JSON.stringify(body), { status: url.includes('saucelabs') ? 201 : 200 });
    }) as unknown as typeof fetch;
    expect(await uploadApp(SAUCE, apk, fake)).toBe('storage:f-1');
    expect(await uploadApp(SAUCE, apk, fake)).toBe('storage:f-1'); // cached
    expect(await uploadApp(BS, apk, fake)).toBe('bs://a1b2');
    expect(calls.map((c) => [c.url, c.fields])).toEqual([
      ['https://api.us-west-1.saucelabs.com/v1/storage/upload', ['payload', 'name']],
      ['https://api-cloud.browserstack.com/app-automate/upload', ['file', 'custom_id']],
    ]);
    expect(calls[0]?.auth).toBe(`Basic ${Buffer.from('sam:sauce-key-123').toString('base64')}`);
    expect(await uploadApp(BS, 'bs://already', fake)).toBe('bs://already');
    await expect(uploadApp(BS, join(dir, 'missing.apk'), fake)).rejects.toThrow('no file');
  });

  it('reports a refused upload without the key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-cloud-'));
    const apk = join(dir, 'other.apk');
    writeFileSync(apk, 'OTHER');
    const fake = (async () => new Response('bad key bs-key-456', { status: 401 })) as unknown as typeof fetch;
    await expect(uploadApp(BS, apk, fake)).rejects.toThrow('app upload failed (401): bad key ***');
  });
});

describe('remote browsers', () => {
  it('BrowserStack: a Playwright connect endpoint with caps in the URL', () => {
    const r = remoteBrowser({ ...BS, browser: 'chrome', os: 'Windows', osVersion: '11', build: 'b' }, { tunnelName: 't', playwrightVersion: '1.63.0', sessionName: 's' });
    if (r.kind !== 'connect') throw new Error('expected connect');
    const url = new URL(r.wsEndpoint);
    expect(url.origin + url.pathname).toBe('wss://cdp.browserstack.com/playwright');
    expect(JSON.parse(url.searchParams.get('caps') ?? '{}')).toEqual({
      browser: 'chrome',
      os: 'Windows',
      os_version: '11',
      build: 'b',
      name: 's',
      'browserstack.username': 'bea',
      'browserstack.accessKey': 'bs-key-456',
      'browserstack.local': 'true',
      'browserstack.localIdentifier': 't',
      'client.playwrightVersion': '1.63.0',
    });
  });

  it('Sauce Labs: Playwright’s Selenium Grid variables, headed', () => {
    const r = remoteBrowser({ ...SAUCE, region: 'eu-central-1' }, { tunnelName: 't' });
    if (r.kind !== 'selenium') throw new Error('expected selenium');
    expect(r.env.SELENIUM_REMOTE_URL).toBe('https://ondemand.eu-central-1.saucelabs.com:443/wd/hub');
    expect(JSON.parse(r.env.SELENIUM_REMOTE_CAPABILITIES ?? '{}')).toMatchObject({
      platformName: 'Windows 11',
      browserName: 'chrome',
      'sauce:options': { username: 'sam', tunnelName: 't', devTools: true },
    });
  });

  it('@playwright/mcp gets a remoteEndpoint config (BrowserStack) or the grid variables (Sauce)', () => {
    const server = { command: 'npx', args: ['@playwright/mcp', '--browser', 'chrome', '--headless', '--isolated'] };
    const bs = cloudServerSpec(server, BS, {});
    const cfg = bs.args?.[bs.args.indexOf('--config') + 1] as string;
    const remote = JSON.parse(readFileSync(cfg, 'utf8')).browser.remoteEndpoint as { endpoint: string; headers: Record<string, string> };
    expect(remote.endpoint).toMatch(/^wss:\/\/cdp\.browserstack\.com\/playwright\?caps=/);
    expect(remote.headers).toEqual({ 'x-playwright-browser': 'chromium' });
    expect(bs.args).not.toContain('--headless');
    const sauce = cloudServerSpec(server, SAUCE, {});
    expect(sauce.env?.SELENIUM_REMOTE_URL).toContain('saucelabs.com');
    expect(sauce.args).toEqual(['@playwright/mcp', '--browser', 'chrome', '--isolated']);
  });
});

describe('tunnels', () => {
  function fakeProcess(lines: string[]) {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, kill: vi.fn() });
    proc.kill.mockImplementation(() => {
      proc.exitCode = 0;
      proc.emit('exit', 0);
      return true;
    });
    setTimeout(() => lines.forEach((l) => proc.stdout.write(`${l}\n`)), 5);
    return proc;
  }

  it('starts Sauce Connect 5 and waits for "you may start your tests"', async () => {
    let args: string[] = [];
    const spawn = ((bin: string, a: string[]) => {
      args = [bin, ...a];
      return fakeProcess(['provisioning tunnel', 'Sauce Connect is up, you may start your tests']);
    }) as never;
    const t = await openTunnel({ ...SAUCE, region: 'eu-central-1', tunnel: true }, { spawn });
    expect(args.slice(0, 2)).toEqual(['sc', 'run']);
    expect(args).toEqual(expect.arrayContaining(['--region', 'eu-central', '--tunnel-name', t?.name ?? '']));
    expect(t?.owned).toBe(true);
    await t?.stop();
  });

  it('fails with the tunnel’s own output, never the key', async () => {
    const spawn = (() => {
      const p = fakeProcess(['auth failed for sauce-key-123']);
      setTimeout(() => {
        p.exitCode = 1;
        p.emit('exit', 1);
      }, 20);
      return p;
    }) as never;
    await expect(openTunnel({ ...SAUCE, tunnel: true }, { spawn })).rejects.toThrow(/exited \(1\)[\s\S]*auth failed for \*\*\*/);
  });

  it('starts BrowserStack Local as a daemon and checks it connected', async () => {
    const seen: string[][] = [];
    const exec = async (bin: string, a: string[]) => {
      seen.push([bin, ...a]);
      return { stdout: a.includes('start') ? '{"state":"connected","pid":1,"message":"Connected"}' : '{"state":"disconnected"}' };
    };
    const t = await openTunnel({ ...BS, tunnel: true }, { exec, name: 'fixed' });
    expect(t?.name).toBe('fixed');
    expect(seen[0]).toEqual(['BrowserStackLocal', '--key', 'bs-key-456', '--local-identifier', 'fixed', '--daemon', 'start', '--force-local']);
    await t?.stop();
    expect(seen[1]).toEqual(['BrowserStackLocal', '--key', 'bs-key-456', '--local-identifier', 'fixed', '--daemon', 'stop']);
    expect(await openTunnel({ ...BS, tunnel: 'ci-tunnel' })).toMatchObject({ name: 'ci-tunnel', owned: false });
    expect(await openTunnel(BS)).toBeUndefined();
  });
});

describe('appium on a cloud', () => {
  it('uploads the build, opens the session on the vendor hub with its caps, marks it, links it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-cloud-'));
    const apk = join(dir, 'app.apk');
    writeFileSync(apk, 'APK-2');
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { method?: string; body?: unknown } = {}) => {
      calls.push({ method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url.endsWith('/app-automate/upload')) return new Response(JSON.stringify({ app_url: 'bs://up' }));
      if (url.endsWith('/sessions/s9.json')) return new Response(JSON.stringify({ automation_session: { public_url: 'https://bs/public/s9' } }));
      if (url.endsWith('/session')) return new Response(JSON.stringify({ value: { sessionId: 's9' } }));
      return new Response(JSON.stringify({ value: null }));
    });
    const driver = createAppiumDriver({
      url: '',
      os: 'android',
      appId: 'com.x.e2e',
      scheme: 'x',
      capabilities: { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': 'emulator-5554' },
      cloud: { ...BS, app: apk, device: 'Google Pixel 8' },
      sessionName: 'e2e-ai android',
    });
    expect(driver.startRecording).toBeUndefined(); // the vendor records the session
    await driver.start();
    const session = calls.find((c) => c.url === 'https://hub.browserstack.com/wd/hub/session');
    const caps = (session?.body as { capabilities: { alwaysMatch: Record<string, unknown> } }).capabilities.alwaysMatch;
    expect(caps['appium:app']).toBe('bs://up');
    expect(caps['appium:udid']).toBeUndefined();
    expect(caps['bstack:options']).toMatchObject({ deviceName: 'Google Pixel 8', sessionName: 'e2e-ai android' });
    expect(await driver.links?.()).toEqual([{ label: 'browserstack session (video, logs)', url: 'https://bs/public/s9' }]);
    await driver.stop({ passed: false, scenarios: 11, failed: 2 });
    const status = calls.find((c) => c.url.endsWith('/execute/sync'));
    expect((status?.body as { script: string }).script).toContain('"status":"failed","reason":"9/11 scenarios passed"');
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://hub.browserstack.com/wd/hub/session/s9' });
  });

  it('falls back to WebDriver navigation when a cloud lacks mobile: deepLink', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
      calls.push(url);
      if (url.endsWith('/session')) return new Response(JSON.stringify({ value: { sessionId: 's1' } }));
      if (url.endsWith('/execute/sync') && init.body?.includes('deepLink')) return new Response(JSON.stringify({ value: { error: 'unknown method', message: 'no' } }), { status: 404 });
      return new Response(JSON.stringify({ value: null }));
    });
    const driver = createAppiumDriver({ url: '', os: 'ios', appId: 'com.x', scheme: 'x', capabilities: {}, cloud: { ...SAUCE, app: 'storage:1' } });
    await driver.start();
    await driver.navigate?.('signin');
    expect(calls.at(-1)).toBe('https://ondemand.us-west-1.saucelabs.com/wd/hub/session/s1/url');
  });
});
