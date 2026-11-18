#!/usr/bin/env node
// `npm start -w @pn/fixture-api` → the fixture API on localhost:4010 (PN_API_PORT overrides).
import { DEFAULT_PORT, startServer } from './server.ts';

const port = Number(process.env.PN_API_PORT ?? DEFAULT_PORT);
await startServer(port);
console.log(`fixture-api listening on http://127.0.0.1:${port}`);
