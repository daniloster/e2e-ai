// Our native driver on a device cloud: the vendor's Appium session installs and launches the app,
// takes screenshots and records the video; our in-app bridge (an e2e build whose bridge URL points
// at the tunnel, e.g. ws://bs-local.com:4011) reads the screen and acts, as it does locally.
import { createAppiumDriver, type AppiumOptions } from './appium.ts';
import { createRnBridgeDriver, type RnBridgeOptions } from './rnBridge.ts';
import type { Driver } from '../types.ts';

export function createRnBridgeCloudDriver(opts: { bridge: RnBridgeOptions; appium: AppiumOptions }): Driver {
  if (!opts.appium.cloud) throw new Error('rn-bridge on a cloud needs target.cloud');
  const bridge = createRnBridgeDriver({ ...opts.bridge, connectTimeoutMs: opts.bridge.connectTimeoutMs ?? 180_000 });
  // The bridge resets the app; the Appium session only hosts it.
  const appium = createAppiumDriver({ ...opts.appium });
  return {
    platform: 'mobile',
    name: `rn-bridge-${opts.appium.cloud.provider}`,
    async start() {
      // The bridge server must listen before the app starts, and start() resolves once the app connected.
      const connected = bridge.start();
      connected.catch(() => undefined);
      try {
        await appium.start();
        await connected;
        // The cloud may relaunch the app right after installing it; talk to the instance that stays.
        await bridge.settle(3000);
      } catch (e) {
        await appium.stop().catch(() => undefined);
        await bridge.stop().catch(() => undefined);
        throw e;
      }
    },
    async stop(outcome) {
      await bridge.stop().catch(() => undefined);
      await appium.stop(outcome);
    },
    links: () => appium.links?.() ?? Promise.resolve([]),
    resetApp: () => bridge.resetApp(),
    openRoute: (route, params) => bridge.openRoute(route, params),
    navigate: (target) => (bridge.navigate as (t: string) => Promise<void>)(target),
    snapshot: () => bridge.snapshot(),
    tap: (ref) => bridge.tap(ref),
    fill: (ref, text) => bridge.fill(ref, text),
    screenshot: (path) => (appium.screenshot as (p: string) => Promise<void>)(path),
  };
}
