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
import type { Driver, Platform, RouteSpec } from '../types.ts';
import { createAppiumDriver } from './appium.ts';
import { createMaestroDriver } from './maestro.ts';
import { createPlaywrightMcpDriver } from './playwrightMcp.ts';
import { createRnBridgeDriver } from './rnBridge.ts';

export type DriverConfig =
  | ({ type: 'mcp' } & McpServerSpec)
  | ({ type: 'playwright-mcp'; baseUrl: string; startPath?: string } & McpServerSpec)
  | { type: 'appium'; url: string; appId: string; scheme: string; resetLink?: string; readyTimeoutMs?: number; capabilities: Record<string, unknown> }
  | { type: 'maestro'; device?: string; appId: string; scheme: string; resetLink?: string; maestro?: string }
  | { type: 'rn-bridge'; port?: number; launch?: string[]; simulator?: string; android?: { serial?: string } };

export interface TargetConfig {
  platform: Platform;
  /** Mobile OS (for appium/maestro/rn-bridge on Android). */
  os?: 'ios' | 'android';
  description?: string;
  driver?: DriverConfig;
  /** Legacy shape (first spike): an MCP server spec. */
  mcp?: McpServerSpec;
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
    case 'mcp':
      return createMcpDriver({ name, platform: t.platform, server: cfg, routes });
    case 'playwright-mcp':
      return withRoutes(createPlaywrightMcpDriver({ baseUrl: cfg.baseUrl, ...(cfg.startPath ? { startPath: cfg.startPath } : {}), server: cfg }), 'web', routes);
    case 'appium':
      return withRoutes(
        createAppiumDriver({ url: cfg.url, os, appId: cfg.appId, scheme: cfg.scheme, capabilities: cfg.capabilities, ...(cfg.resetLink ? { resetLink: cfg.resetLink } : {}), ...(cfg.readyTimeoutMs ? { readyTimeoutMs: cfg.readyTimeoutMs } : {}) }),
        'mobile',
        routes,
      );
    case 'maestro':
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
