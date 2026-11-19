// A local stand-in for Sauce Labs / BrowserStack, for testing the cloud integration without an
// account: it speaks the vendors' upload and session APIs and forwards WebDriver traffic to a real
// local Appium (so the app really runs on a local emulator/simulator). What it checks is what the
// vendors check: credentials in the vendor options, an uploaded app reference, the session-status
// scripts. Dev/test only.
//
//   node packages/e2e-ai/src/cloud/fakeCloud.ts --port 4800 --appium http://127.0.0.1:4723
//   then a target with  "cloud": { "provider": "browserstack", "hub": "http://127.0.0.1:4800/wd/hub",
//                                  "api": "http://127.0.0.1:4800", "username": "u", "accessKey": "k", … }
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeCloudLog {
  uploads: { provider: string; name: string; ref: string; auth: boolean }[];
  sessions: { id: string; provider: string; caps: Record<string, unknown> }[];
  browsers: { id: string; caps: Record<string, unknown> }[];
  statuses: { session: string; script: string }[];
  rejected: string[];
}

export async function startFakeCloud(opts: { port: number; appium: string }): Promise<{ server: Server; log: FakeCloudLog; url: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'fake-cloud-'));
  const apps = new Map<string, string>(); // ref → local path
  const log: FakeCloudLog = { uploads: [], sessions: [], browsers: [], statuses: [], rejected: [] };
  const chromes = new Map<string, ChildProcess>();
  const appium = opts.appium.replace(/\/$/, '');

  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  };
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      const raw = await body(req);
      const auth = /^Basic /.test(req.headers.authorization ?? '');
      // App uploads (multipart), as each vendor documents them.
      if (req.method === 'POST' && (url === '/v1/storage/upload' || url === '/app-automate/upload')) {
        const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: raw }).formData();
        const sauce = url.startsWith('/v1/');
        const file = form.get(sauce ? 'payload' : 'file') as File | null;
        if (!auth || !file) {
          log.rejected.push(`upload without ${auth ? 'file' : 'credentials'}`);
          return json(res, 401, { message: 'unauthorized' });
        }
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${apps.size}-${file.name}`);
        writeFileSync(path, Buffer.from(await file.arrayBuffer()));
        const id = `app${apps.size + 1}`;
        const ref = sauce ? `storage:${id}` : `bs://${id}`;
        apps.set(ref, path);
        log.uploads.push({ provider: sauce ? 'saucelabs' : 'browserstack', name: file.name, ref, auth });
        return json(res, sauce ? 201 : 200, sauce ? { item: { id } } : { app_url: ref, custom_id: form.get('custom_id') });
      }
      const sessionInfo = /^\/app-automate\/sessions\/([^/]+)\.json$/.exec(url);
      if (sessionInfo) return json(res, 200, { automation_session: { public_url: `http://127.0.0.1:${opts.port}/dashboard/${sessionInfo[1]}` } });
      if (!url.startsWith('/wd/hub')) return json(res, 404, { message: 'not found' });

      const path = url.slice('/wd/hub'.length);
      let forward: Buffer | undefined = raw.length ? raw : undefined;
      // Desktop browsers, the way Selenium Grid 4 answers Playwright: a Chrome with its CDP endpoint (se:cdp).
      const browserSession = /^\/session\/([^/]+)$/.exec(path);
      if (req.method === 'DELETE' && browserSession && chromes.has(browserSession[1] as string)) {
        chromes.get(browserSession[1] as string)?.kill();
        chromes.delete(browserSession[1] as string);
        return json(res, 200, { value: null });
      }
      if (req.method === 'POST' && path === '/session') {
        const peek = (JSON.parse(raw.toString()) as { capabilities: { alwaysMatch: Record<string, unknown> } }).capabilities.alwaysMatch;
        if (peek.browserName === 'chrome' || peek.browserName === 'MicrosoftEdge') {
          const sauce = peek['sauce:options'] as Record<string, unknown> | undefined;
          if (!sauce?.username || !sauce.accessKey) {
            log.rejected.push('browser session without sauce:options credentials');
            return json(res, 401, { value: { error: 'session not created', message: 'missing vendor credentials' } });
          }
          const { chromium } = await import('playwright-core');
          const profile = mkdtempSync(join(tmpdir(), 'fake-grid-chrome-'));
          const args = ((peek['goog:chromeOptions'] as { args?: string[] } | undefined)?.args ?? []).filter((a) => !a.startsWith('--remote-debugging'));
          const proc = spawn(chromium.executablePath(), [...args, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
          const portFile = join(profile, 'DevToolsActivePort');
          for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
          const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
          const id = `grid-${chromes.size + 1}-${Date.now()}`;
          chromes.set(id, proc);
          log.browsers.push({ id, caps: peek });
          return json(res, 200, { value: { sessionId: id, capabilities: { browserName: 'chrome', 'se:cdp': `ws://127.0.0.1:${port}${wsPath}`, 'se:cdpVersion': '153' } } });
        }
        const payload = JSON.parse(raw.toString()) as { capabilities: { alwaysMatch: Record<string, unknown> } };
        const caps = { ...payload.capabilities.alwaysMatch };
        const sauce = caps['sauce:options'] as Record<string, unknown> | undefined;
        const bs = caps['bstack:options'] as Record<string, unknown> | undefined;
        const provider = sauce ? 'saucelabs' : bs ? 'browserstack' : '';
        const credOk = sauce ? !!(sauce.username && sauce.accessKey) : bs ? !!(bs.userName && bs.accessKey) : false;
        if (!credOk) {
          log.rejected.push('session without vendor credentials');
          return json(res, 401, { value: { error: 'session not created', message: 'missing vendor credentials' } });
        }
        const app = String(caps['appium:app'] ?? '');
        const local = apps.get(app);
        if (!local) {
          log.rejected.push(`unknown app ${app}`);
          return json(res, 400, { value: { error: 'session not created', message: `unknown app ${app}` } });
        }
        delete caps['sauce:options'];
        delete caps['bstack:options'];
        delete caps['appium:deviceName'];
        delete caps['appium:platformVersion'];
        caps['appium:app'] = local;
        forward = Buffer.from(JSON.stringify({ capabilities: { alwaysMatch: caps, firstMatch: [{}] } }));
        const r = await fetch(`${appium}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array(forward) });
        const text = await r.text();
        const id = (JSON.parse(text) as { value?: { sessionId?: string } }).value?.sessionId;
        if (id) log.sessions.push({ id, provider, caps: payload.capabilities.alwaysMatch });
        res.writeHead(r.status, { 'content-type': 'application/json' });
        return res.end(text);
      }
      // Vendor session-status scripts never reach the device.
      const exec = /^\/session\/([^/]+)\/execute\/sync$/.exec(path);
      if (exec && req.method === 'POST') {
        const script = String((JSON.parse(raw.toString()) as { script?: string }).script ?? '');
        if (/^(sauce:job-result=|browserstack_executor:)/.test(script)) {
          log.statuses.push({ session: exec[1] as string, script });
          return json(res, 200, { value: null });
        }
      }
      const r = await fetch(`${appium}${path}`, {
        method: req.method ?? 'GET',
        headers: { 'content-type': 'application/json' },
        ...(forward && req.method !== 'GET' && req.method !== 'DELETE' ? { body: new Uint8Array(forward) } : {}),
      });
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      json(res, 500, { value: { error: 'unknown error', message: e instanceof Error ? e.message : String(e) } });
    }
  });
  await new Promise<void>((r) => server.listen(opts.port, '127.0.0.1', () => r()));
  return { server, log, url: `http://127.0.0.1:${opts.port}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string, d: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? (process.argv[i + 1] ?? d) : d;
  };
  const { log, url } = await startFakeCloud({ port: Number(arg('port', '4800')), appium: arg('appium', 'http://127.0.0.1:4723') });
  console.log(`fake cloud on ${url} (hub ${url}/wd/hub)`);
  process.on('SIGINT', () => {
    console.log(JSON.stringify(log, null, 2));
    process.exit(0);
  });
  setInterval(() => undefined, 1 << 30);
}
