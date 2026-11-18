// Site e2e (e2e/site*.spec.ts): builds dist/ and serves it over HTTPS on 5443 (https/serve.mjs), then
// runs the specs against the built pages with the production CSP. Stop any local server on 5443 first:
// reuseExistingServer would skip the build and test a stale dist/.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  projects: [
    {
      name: 'site',
      testMatch: /(^|[\\/])site[A-Za-z]*\.spec\.ts$/,
      use: {
        browserName: 'chromium',
        baseURL: 'https://localhost:5443',
        ignoreHTTPSErrors: true,
        locale: 'en-GB',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
      },
    },
  ],
  webServer: {
    command: 'npm run build && node https/serve.mjs dist 5443',
    url: 'https://localhost:5443/',
    ignoreHTTPSErrors: true,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
