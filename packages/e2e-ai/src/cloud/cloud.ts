// Device and browser clouds (Sauce Labs, BrowserStack). A target gets a `cloud` block and keeps its
// integration: Appium and our RN bridge run against the vendor's Appium hub, Playwright (our web
// driver, @playwright/mcp, Playwright Test) against the vendor's remote browsers, Maestro through
// flows compiled from the reviewed plans (see maestroCloud.ts).
//
//   "cloud": { "provider": "browserstack", "app": "../apps/mobile/android/app/build/outputs/apk/e2e/app-e2e.apk",
//              "device": "Google Pixel 8", "platformVersion": "14.0", "tunnel": true, "build": "${CI_RUN:-local}" }
//
// Credentials come from the config or, better, the environment: SAUCE_USERNAME / SAUCE_ACCESS_KEY,
// BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY. They are sent only to the vendor and never logged.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type CloudProvider = 'saucelabs' | 'browserstack';

export interface CloudConfig {
  provider: CloudProvider;
  username?: string;
  accessKey?: string;
  /** Sauce Labs data center: us-west-1 (default), eu-central-1, us-east-4. */
  region?: string;
  /** Mobile: a local build to upload (.apk, .aab, .ipa, zipped .app) or an uploaded reference (storage:…, bs://…). */
  app?: string;
  /** Mobile device name (vendor naming; Sauce accepts regular expressions) and OS version. */
  device?: string;
  platformVersion?: string;
  /** Web: browser and OS. */
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  /** true = start a tunnel (Sauce Connect `sc` / `BrowserStackLocal` on PATH); a string = use that running tunnel. */
  tunnel?: boolean | string;
  /** Path of the tunnel binary when it is not on PATH. */
  tunnelBinary?: string;
  /** Grouping shown in the vendor dashboard. */
  build?: string;
  project?: string;
  name?: string;
  /** Extra vendor options merged into sauce:options / bstack:options (or the BrowserStack Playwright caps). */
  options?: Record<string, unknown>;
  /** Overrides: a self-hosted or proxied hub / REST API (also how the tests point at a fake cloud). */
  hub?: string;
  api?: string;
}

export interface CloudCredentials {
  username: string;
  accessKey: string;
}

const ENV: Record<CloudProvider, [string, string]> = {
  saucelabs: ['SAUCE_USERNAME', 'SAUCE_ACCESS_KEY'],
  browserstack: ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'],
};

export const CLOUD_PROVIDERS = Object.keys(ENV) as CloudProvider[];

export function validateCloud(c: CloudConfig): void {
  if (!CLOUD_PROVIDERS.includes(c.provider)) throw new Error(`cloud.provider must be one of ${CLOUD_PROVIDERS.join(', ')} (got "${String(c.provider)}")`);
  if (c.provider === 'saucelabs' && c.region && !/^[a-z]+-[a-z]+-\d+$/.test(c.region)) {
    throw new Error(`cloud.region "${c.region}" is not a Sauce Labs data center (us-west-1, eu-central-1, us-east-4)`);
  }
}

export function credentials(c: CloudConfig, env: NodeJS.ProcessEnv = process.env): CloudCredentials {
  const [u, k] = ENV[c.provider];
  const username = c.username || env[u] || '';
  const accessKey = c.accessKey || env[k] || '';
  if (!username || !accessKey) throw new Error(`${c.provider}: set ${u} and ${k} (or cloud.username / cloud.accessKey)`);
  return { username, accessKey };
}

const sauceRegion = (c: CloudConfig) => c.region ?? 'us-west-1';

export function appiumHub(c: CloudConfig): string {
  if (c.hub) return c.hub.replace(/\/$/, '');
  return c.provider === 'saucelabs' ? `https://ondemand.${sauceRegion(c)}.saucelabs.com/wd/hub` : 'https://hub.browserstack.com/wd/hub';
}

export function apiBase(c: CloudConfig): string {
  if (c.api) return c.api.replace(/\/$/, '');
  return c.provider === 'saucelabs' ? `https://api.${sauceRegion(c)}.saucelabs.com` : 'https://api-cloud.browserstack.com';
}

export const basicAuth = (cred: CloudCredentials) => `Basic ${Buffer.from(`${cred.username}:${cred.accessKey}`).toString('base64')}`;

/** Masks an access key wherever a message might echo it. */
export function redact(text: string, cred?: CloudCredentials): string {
  return cred?.accessKey ? text.split(cred.accessKey).join('***') : text;
}

/** A reference the vendor already knows: nothing to upload. */
export const isUploadedApp = (app: string) => /^(storage:|bs:\/\/|https?:\/\/)/.test(app);

const uploads = new Map<string, string>();

/**
 * Uploads a local build once per content hash and run; returns the value for `appium:app`
 * (Sauce `storage:<id>`, BrowserStack `bs://<id>`).
 */
export async function uploadApp(c: CloudConfig, file: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (isUploadedApp(file)) return file;
  if (!existsSync(file)) throw new Error(`cloud.app: no file ${file} (build it first, or give an uploaded reference)`);
  const bytes = readFileSync(file);
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const key = `${c.provider}:${apiBase(c)}:${sha}`;
  const cached = uploads.get(key);
  if (cached) return cached;
  const cred = credentials(c);
  const form = new FormData();
  const blob = new Blob([bytes]);
  let url: string;
  if (c.provider === 'saucelabs') {
    url = `${apiBase(c)}/v1/storage/upload`;
    form.append('payload', blob, basename(file));
    form.append('name', basename(file));
  } else {
    url = `${apiBase(c)}/app-automate/upload`;
    form.append('file', blob, basename(file));
    form.append('custom_id', `e2e-ai-${sha}`);
  }
  const res = await fetchImpl(url, { method: 'POST', headers: { authorization: basicAuth(cred) }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`${c.provider} app upload failed (${res.status}): ${redact(text.slice(0, 300), cred)}`);
  const json = JSON.parse(text) as { item?: { id?: string }; app_url?: string };
  const ref = c.provider === 'saucelabs' ? (json.item?.id ? `storage:${json.item.id}` : '') : (json.app_url ?? '');
  if (!ref) throw new Error(`${c.provider} app upload: unexpected answer ${text.slice(0, 200)}`);
  uploads.set(key, ref);
  return ref;
}

/** Capabilities that only make sense for a local device; a cloud picks the device itself. */
const LOCAL_ONLY = ['appium:udid', 'appium:avd', 'appium:wdaLocalPort', 'appium:systemPort', 'appium:derivedDataPath'];

export interface SessionLabels {
  app?: string;
  tunnelName?: string;
  sessionName?: string;
}

/** The local Appium capabilities, turned into the vendor's (device, app, auth, tunnel, labels). */
export function cloudAppiumCapabilities(c: CloudConfig, base: Record<string, unknown>, l: SessionLabels = {}): Record<string, unknown> {
  const cred = credentials(c);
  const caps: Record<string, unknown> = { ...base };
  for (const k of LOCAL_ONLY) delete caps[k];
  if (l.app) caps['appium:app'] = l.app;
  // The app is installed by the cloud from `appium:app`; launch by package/bundle id stays as configured.
  if (c.provider === 'saucelabs') {
    if (c.device) caps['appium:deviceName'] = c.device;
    if (c.platformVersion) caps['appium:platformVersion'] = c.platformVersion;
    caps['sauce:options'] = {
      username: cred.username,
      accessKey: cred.accessKey,
      ...(c.build ? { build: c.build } : {}),
      ...(l.sessionName || c.name ? { name: l.sessionName ?? c.name } : {}),
      ...(l.tunnelName ? { tunnelName: l.tunnelName } : {}),
      appiumVersion: 'latest',
      ...(c.options ?? {}),
    };
  } else {
    caps['bstack:options'] = {
      userName: cred.username,
      accessKey: cred.accessKey,
      ...(c.device ? { deviceName: c.device } : {}),
      ...(c.platformVersion ? { osVersion: c.platformVersion } : {}),
      ...(c.build ? { buildName: c.build } : {}),
      ...(c.project ? { projectName: c.project } : {}),
      ...(l.sessionName || c.name ? { sessionName: l.sessionName ?? c.name } : {}),
      ...(l.tunnelName ? { local: true, localIdentifier: l.tunnelName } : {}),
      ...(c.options ?? {}),
    };
  }
  return caps;
}

/** The script that marks the remote session passed/failed in the vendor dashboard. */
export function sessionStatusScript(c: CloudConfig, passed: boolean, reason: string): string {
  return c.provider === 'saucelabs'
    ? `sauce:job-result=${passed ? 'passed' : 'failed'}`
    : `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status: passed ? 'passed' : 'failed', reason: reason.slice(0, 255) } })}`;
}

/** Dashboard link for a session (BrowserStack's public link needs a REST lookup: `sessionPublicUrl`). */
export function sessionUrl(c: CloudConfig, sessionId: string, kind: 'app' | 'web' = 'app'): string {
  if (c.provider === 'saucelabs') {
    const host = sauceRegion(c).startsWith('eu') ? 'app.eu-central-1.saucelabs.com' : 'app.saucelabs.com';
    return `https://${host}/tests/${sessionId}`;
  }
  return kind === 'app' ? `https://app-automate.browserstack.com/dashboard/v2/sessions/${sessionId}` : `https://automate.browserstack.com/dashboard/v2/sessions/${sessionId}`;
}

/** BrowserStack's shareable session link (video, logs) — falls back to the dashboard link. */
export async function sessionPublicUrl(c: CloudConfig, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (c.provider !== 'browserstack') return sessionUrl(c, sessionId);
  try {
    const res = await fetchImpl(`${apiBase(c)}/app-automate/sessions/${sessionId}.json`, { headers: { authorization: basicAuth(credentials(c)) } });
    const j = (await res.json()) as { automation_session?: { public_url?: string; browser_url?: string } };
    return j.automation_session?.public_url ?? j.automation_session?.browser_url ?? sessionUrl(c, sessionId);
  } catch {
    return sessionUrl(c, sessionId);
  }
}

// ---------------------------------------------------------------- web (Playwright)

/**
 * How Playwright reaches the vendor's browsers:
 * - BrowserStack: a remote Playwright server (`chromium.connect(wsEndpoint)`), caps in the URL.
 * - Sauce Labs: Playwright's Selenium Grid mode (`SELENIUM_REMOTE_URL` + `SELENIUM_REMOTE_CAPABILITIES`),
 *   Chrome/Edge only, headed (Sauce records video only then). Sauce calls this experimental.
 */
export type RemoteBrowser =
  | { kind: 'connect'; wsEndpoint: string; statusScript: (passed: boolean, reason: string) => string }
  | { kind: 'selenium'; env: Record<string, string>; headed: true };

export function remoteBrowser(c: CloudConfig, l: SessionLabels & { playwrightVersion?: string } = {}): RemoteBrowser {
  const cred = credentials(c);
  if (c.provider === 'browserstack') {
    const caps = {
      browser: c.browser ?? 'chrome',
      ...(c.browserVersion ? { browser_version: c.browserVersion } : {}),
      os: c.os ?? 'OS X',
      os_version: c.osVersion ?? 'Sonoma',
      ...(c.build ? { build: c.build } : {}),
      ...(c.project ? { project: c.project } : {}),
      ...(l.sessionName || c.name ? { name: l.sessionName ?? c.name } : {}),
      'browserstack.username': cred.username,
      'browserstack.accessKey': cred.accessKey,
      ...(l.tunnelName ? { 'browserstack.local': 'true', 'browserstack.localIdentifier': l.tunnelName } : {}),
      ...(l.playwrightVersion ? { 'client.playwrightVersion': l.playwrightVersion } : {}),
      ...(c.options ?? {}),
    };
    const hub = c.hub ?? 'wss://cdp.browserstack.com/playwright';
    return {
      kind: 'connect',
      wsEndpoint: `${hub}?caps=${encodeURIComponent(JSON.stringify(caps))}`,
      statusScript: (passed, reason) => sessionStatusScript(c, passed, reason),
    };
  }
  const caps = {
    platformName: c.os ?? 'Windows 11',
    browserName: c.browser ?? 'chrome',
    ...(c.browserVersion ? { browserVersion: c.browserVersion } : { browserVersion: 'latest' }),
    'sauce:options': {
      username: cred.username,
      accessKey: cred.accessKey,
      devTools: true,
      ...(c.build ? { build: c.build } : {}),
      ...(l.sessionName || c.name ? { name: l.sessionName ?? c.name } : {}),
      ...(l.tunnelName ? { tunnelName: l.tunnelName } : {}),
      ...(c.options ?? {}),
    },
  };
  const hub = c.hub ?? `https://ondemand.${sauceRegion(c)}.saucelabs.com:443/wd/hub`;
  return { kind: 'selenium', env: { SELENIUM_REMOTE_URL: hub, SELENIUM_REMOTE_CAPABILITIES: JSON.stringify(caps) }, headed: true };
}
