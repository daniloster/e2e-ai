// Targets → drivers. A target names the platform and the integration the engine drives it with:
//
//   type            platform      how the engine interacts
//   mcp             web | mobile  any MCP server with the ui_* tools (ours: web-mcp = Playwright, rn-mcp = RN bridge)
//   playwright-mcp  web           Microsoft's @playwright/mcp server (browser_* tools, ARIA snapshot)
//   appium          mobile        an Appium server (W3C WebDriver; XCUITest on iOS, UiAutomator2 on Android)
//   maestro         mobile        the Maestro CLI (hierarchy + one-command flows)
//   rn-bridge       mobile        the app's in-app bridge, in-process (no MCP hop)
//   (Playwright Test is the other way round: `e2e-ai playwright init` makes Playwright run the
//    features, with this engine driving Playwright's own `page` — see src/playwright.ts.)
//
// Route names from the app guide are resolved here for every integration: the web column becomes a
// URL path, the mobile column a deep link (`<scheme>://<route>`), with {params} filled from facts.
import type { McpServerSpec } from '../mcp/mcpDriver.ts';
import { createMcpDriver, fillTemplate } from '../mcp/mcpDriver.ts';
import type { CloudConfig } from '../cloud/cloud.ts';
import { currentRoles } from '../roles.ts';
import type { Driver, Platform, RouteSpec } from '../types.ts';
import { createAppiumDriver } from './appium.ts';
import { createMaestroDriver } from './maestro.ts';
import { createPlaywrightMcpDriver } from './playwrightMcp.ts';
import { createRnBridgeDriver } from './rnBridge.ts';
import { createRnBridgeCloudDriver } from './rnBridgeCloud.ts';

export type DriverConfig =
  | ({ type: 'mcp' } & McpServerSpec)
  | ({ type: 'playwright-mcp'; baseUrl: string; startPath?: string } & McpServerSpec)
  | {
      type: 'appium';
      url?: string;
      appId: string;
      scheme: string;
      resetLink?: string;
      readyTimeoutMs?: number;
      capabilities: Record<string, unknown>;
      systemAlerts?: 'dismiss' | 'accept' | 'leave';
    }
  | {
      type: 'maestro';
      device?: string;
      appId: string;
      scheme: string;
      resetLink?: string;
      maestro?: string;
      /** On a cloud (target.cloud): Appium capabilities for the device, and how flows run there. */
      capabilities?: Record<string, unknown>;
      runner?: 'maestro-runner' | 'browserstack-api';
      maestroRunner?: string[];
    }
  | {
      type: 'rn-bridge';
      port?: number;
      launch?: string[];
      simulator?: string;
      android?: { serial?: string };
      /** On a cloud (target.cloud): the app to launch there and the Appium capabilities to do it with. */
      appId?: string;
      scheme?: string;
      capabilities?: Record<string, unknown>;
    };

export interface TargetConfig {
  platform: Platform;
  /** Mobile OS (for appium/maestro/rn-bridge on Android). */
  os?: 'ios' | 'android';
  description?: string;
  driver?: DriverConfig;
  /** Legacy shape (first spike): an MCP server spec. */
  mcp?: McpServerSpec;
  /** Run this target on Sauce Labs or BrowserStack (see cloud/cloud.ts). */
  cloud?: CloudConfig;
}

/** Gives drivers that only know `navigate(target)` the app guide's named routes. */
export function withRoutes(driver: Driver, platform: Platform, routes: Record<string, RouteSpec>): Driver {
  return {
    ...driver,
    async openRoute(route, params = {}) {
      const spec = routes[route];
      const template = platform === 'web' ? spec?.web : spec?.mobile;
      if (!template) throw new Error(`route ${route} has no ${platform} target in the app guide`);
      if (!driver.navigate) throw new Error(`${driver.name} cannot navigate`);
      await driver.navigate(fillTemplate(template, params));
    },
  };
}

export function createDriver(name: string, t: TargetConfig, routes: Record<string, RouteSpec>): Driver {
  const cfg: DriverConfig | undefined = t.driver ?? (t.mcp ? { type: 'mcp', ...t.mcp } : undefined);
  if (!cfg) throw new Error(`target ${name} has no driver`);
  const os = t.os ?? 'ios';
  switch (cfg.type) {
    case 'mcp': {
      // Our MCP driver servers (web-mcp, rn-mcp) read the cloud settings from E2E_CLOUD.
      const roles = currentRoles();
      const env = {
        ...(cfg.env ?? {}),
        ...(t.cloud ? { E2E_CLOUD: JSON.stringify(t.cloud), E2E_SESSION_NAME: `e2e-ai ${name}` } : {}),
        ...(Object.keys(roles).length ? { E2E_ROLES: JSON.stringify(roles) } : {}),
      };
      const server = { ...cfg, env };
      return createMcpDriver({ name, platform: t.platform, server, routes });
    }
    case 'playwright-mcp':
      return withRoutes(
        createPlaywrightMcpDriver({
          baseUrl: cfg.baseUrl,
          ...(cfg.startPath ? { startPath: cfg.startPath } : {}),
          server: cfg,
          ...(t.cloud ? { cloud: t.cloud, sessionName: `e2e-ai ${name}` } : {}),
        }),
        'web',
        routes,
      );
    case 'appium':
      return withRoutes(
        createAppiumDriver({
          url: cfg.url ?? (t.cloud ? '' : 'http://127.0.0.1:4723'),
          os,
          appId: cfg.appId,
          scheme: cfg.scheme,
          capabilities: cfg.capabilities,
          ...(cfg.resetLink ? { resetLink: cfg.resetLink } : {}),
          ...(cfg.readyTimeoutMs ? { readyTimeoutMs: cfg.readyTimeoutMs } : {}),
          ...(cfg.systemAlerts ? { systemAlerts: cfg.systemAlerts } : {}),
          ...(t.cloud ? { cloud: t.cloud, sessionName: `e2e-ai ${name}` } : {}),
        }),
        'mobile',
        routes,
      );
    case 'maestro':
      if (t.cloud) {
        // Cloud Maestro runs whole compiled flows (cloud/maestroCloud.ts); nothing runs locally.
        const off = async () => {
          throw new Error('maestro on a cloud runs compiled flows; use `e2e-ai run`');
        };
        return { platform: 'mobile', name: `maestro-${t.cloud.provider}`, start: async () => undefined, stop: async () => undefined, resetApp: off, openRoute: off, snapshot: off, tap: off, fill: off };
      }
      return withRoutes(
        createMaestroDriver({
          os,
          appId: cfg.appId,
          scheme: cfg.scheme,
          ...(cfg.device ? { device: cfg.device } : {}),
          ...(cfg.resetLink ? { resetLink: cfg.resetLink } : {}),
          ...(cfg.maestro ? { maestro: cfg.maestro } : {}),
        }),
        'mobile',
        routes,
      );
    case 'rn-bridge':
      if (t.cloud) {
        if (!cfg.appId) throw new Error(`target ${name}: rn-bridge on a cloud needs driver.appId`);
        return withRoutes(createRnBridgeCloudDriver({
          bridge: { ...(cfg.port ? { port: cfg.port } : {}) },
          appium: {
            url: '',
            os,
            appId: cfg.appId,
            scheme: cfg.scheme ?? '',
            capabilities: cfg.capabilities ?? {},
            cloud: t.cloud,
            sessionName: `e2e-ai ${name}`,
          },
        }), 'mobile', routes);
      }
      return withRoutes(
        createRnBridgeDriver({
          ...(cfg.port ? { port: cfg.port } : {}),
          ...(cfg.launch ? { launch: cfg.launch } : {}),
          ...(cfg.simulator ? { simulator: cfg.simulator } : {}),
          ...(cfg.android ? { android: cfg.android } : {}),
        }),
        'mobile',
        routes,
      );
  }
}
