#!/usr/bin/env node
// MCP server: a React Native debug app through its in-app e2e bridge (WebSocket :4011).
//   iOS:     node rn-mcp.ts --launch "xcrun simctl launch <udid> com.app.dev" --sim <udid> [--port 4011]
//   Android: node rn-mcp.ts --launch "adb shell monkey -p com.app.dev 1" --android [serial]
//            (run `adb reverse tcp:4011 tcp:4011` (bridge), tcp:4010 (API) and the Metro port first)
import { createRnBridgeDriver } from '../drivers/rnBridge.ts';
import { argv, serveDriver } from './driverServer.ts';

const a = argv();
const launch = a.launch?.split(' ').filter(Boolean);
await serveDriver(
  createRnBridgeDriver({
    ...(launch?.length ? { launch } : {}),
    ...(a.sim ? { simulator: a.sim } : {}),
    ...(a.port ? { port: Number(a.port) } : {}),
    ...(a.android ? { android: a.android === 'true' ? {} : { serial: a.android } } : {}),
  }),
  'e2e-ai-react-native',
);
