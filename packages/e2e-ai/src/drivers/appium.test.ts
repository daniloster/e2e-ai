import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppiumDriver, xpathLiteral } from './appium.ts';

// Appium's UiAutomator2 page source: elements are named after their class, not <node>.
const LOADING = `<?xml version="1.0" encoding="UTF-8"?><hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2400"><android.widget.FrameLayout index="0" package="com.example.dev" class="android.widget.FrameLayout" resource-id="android:id/content" bounds="[0,0][1080,2400]" displayed="true"/></hierarchy>`;
const SIGNIN = `<?xml version="1.0" encoding="UTF-8"?><hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2400">
  <android.widget.FrameLayout index="0" class="android.widget.FrameLayout" resource-id="android:id/content" bounds="[0,0][1080,2400]">
    <android.widget.EditText index="3" package="com.example.dev" class="android.widget.EditText" text="" content-desc="Email" resource-id="signin-email" clickable="true" bounds="[40,400][1040,520]" displayed="true"/>
    <android.view.ViewGroup index="6" class="android.view.ViewGroup" text="" content-desc="" resource-id="signin-submit" clickable="true" bounds="[40,700][1040,820]" displayed="true">
      <android.widget.TextView index="0" class="android.widget.TextView" text="SIGN IN" resource-id="" bounds="[460,740][620,790]" displayed="true"/>
    </android.view.ViewGroup>
  </android.widget.FrameLayout>
</hierarchy>`;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A fake Appium server: answers the WebDriver calls the driver makes and records them. */
function fakeAppium(sources: string[]): Call[] {
  const calls: Call[] = [];
  let read = 0;
  vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
    const path = url.replace('http://appium.test', '');
    const body = init.body ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method: init.method, path, body });
    let value: unknown = null;
    if (path === '/session') value = { sessionId: 's1' };
    else if (path.endsWith('/source')) value = sources[Math.min(read++, sources.length - 1)];
    else if (path.endsWith('/alert/text')) return new Response(JSON.stringify({ value: { error: 'no such alert', message: 'none' } }), { status: 404 });
    else if (path.endsWith('/element')) value = { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };
    return new Response(JSON.stringify({ value }), { status: 200 });
  });
  return calls;
}

function android(extra: Partial<Parameters<typeof createAppiumDriver>[0]> = {}) {
  return createAppiumDriver({
    url: 'http://appium.test',
    os: 'android',
    appId: 'com.example.dev',
    scheme: 'example',
    capabilities: {},
    ...extra,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appium driver (Android)', () => {
  it('finds a testID by resource-id, not accessibility id, so fill reaches inputs', async () => {
    const calls = fakeAppium([SIGNIN]);
    const driver = android();
    await driver.start();
    const els = await driver.snapshot();
    const email = els.findIndex((e) => e.testId === 'signin-email');
    await driver.fill(String(email), 'ana@example.com');
    const find = calls.find((c) => c.path.endsWith('/element'));
    expect(find?.body).toEqual({
      using: 'xpath',
      value: '//*[@resource-id="signin-email" or @resource-id="com.example.dev:id/signin-email"]',
    });
    expect(calls.some((c) => c.path.endsWith('/element/el-1/value'))).toBe(true);
  });

  it('sends the reset link only once the relaunched app shows a settled screen', async () => {
    const calls = fakeAppium([LOADING, LOADING, SIGNIN, SIGNIN, SIGNIN, SIGNIN]);
    const driver = android({ resetLink: 'e2e-reset', readyTimeoutMs: 10_000 });
    await driver.start();
    await driver.resetApp?.();
    const scripts = calls
      .filter((c) => c.path.endsWith('/execute/sync'))
      .map((c) => (c.body as { script: string }).script);
    expect(scripts).toEqual(['mobile: terminateApp', 'mobile: activateApp', 'mobile: deepLink']);
    const link = calls.findIndex((c) => (c.body as { script?: string } | undefined)?.script === 'mobile: deepLink');
    const sourcesBefore = calls.slice(0, link).filter((c) => c.path.endsWith('/source')).length;
    expect(sourcesBefore).toBeGreaterThanOrEqual(4); // two loading reads, then two identical app reads
  });
});

describe('Appium Android page source', () => {
  it('parses class-named elements (not only uiautomator dump <node>s)', async () => {
    fakeAppium([SIGNIN]);
    const driver = android();
    await driver.start();
    const els = await driver.snapshot();
    expect(els.find((e) => e.testId === 'signin-email')).toMatchObject({ role: 'textbox', name: 'Email' });
    expect(els.some((e) => e.testId === 'signin-submit')).toBe(true);
    expect(els.some((e) => e.text === 'SIGN IN')).toBe(true);
  });
});

describe('xpathLiteral', () => {
  it('quotes any text, including both quote kinds', () => {
    expect(xpathLiteral('a')).toBe('"a"');
    expect(xpathLiteral('say "hi"')).toBe(`'say "hi"'`);
    expect(xpathLiteral(`it's "x"`)).toBe(`concat("it's ", '"', "x", '"', "")`);
  });
});
