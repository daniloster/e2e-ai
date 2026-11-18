#!/usr/bin/env node
// MCP server: the web app through Playwright (Chromium).
//   node web-mcp.ts --base-url http://localhost:5180 [--start /app.html] [--headed]
import { createWebDriver } from '../drivers/web.ts';
import { argv, serveDriver } from './driverServer.ts';

const a = argv();
if (!a['base-url']) throw new Error('--base-url is required');
await serveDriver(
  createWebDriver({ baseUrl: a['base-url'], routes: {}, headless: a.headed !== 'true', startPath: a.start ?? '/' }),
  'e2e-ai-web',
);
