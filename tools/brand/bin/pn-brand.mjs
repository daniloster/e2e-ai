#!/usr/bin/env node
// pn-brand launcher: re-spawns Node with type stripping and the resolve hook, using absolute URLs
// so it works from any directory and through npx.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    '--import',
    new URL('./register.mjs', import.meta.url).href,
    fileURLToPath(new URL('../src/main.ts', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
