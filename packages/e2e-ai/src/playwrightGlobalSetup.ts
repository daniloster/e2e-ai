// Playwright Test global setup for a cloud web target with `tunnel: true`: opens Sauce Connect /
// BrowserStack Local under the name cloudUse() fixed (E2E_TUNNEL_NAME) and closes it afterwards.
//   // playwright.config.ts
//   globalSetup: '@pn/e2e-ai/playwright-global-setup',
import { cloudUse } from './playwright.ts';
import { loadConfig } from './config.ts';
import { openTunnel } from './cloud/tunnel.ts';

export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  const configPath = process.env.E2E_CONFIG ?? 'e2e/e2e-ai.config.json';
  cloudUse(configPath);
  const target = process.env.E2E_CLOUD_TARGET;
  const cloud = target ? loadConfig(configPath).targets[target]?.cloud : undefined;
  if (!cloud || cloud.tunnel !== true || !process.env.E2E_TUNNEL_NAME) return;
  const tunnel = await openTunnel(cloud, { name: process.env.E2E_TUNNEL_NAME });
  return async () => {
    await tunnel?.stop();
  };
}
