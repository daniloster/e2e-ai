// Post-build guard: Firebase only from gstatic, at the installed version, allow-listed modules only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CDN_URL = /https:\/\/www\.gstatic\.com\/firebasejs\/([^/"'\s`]+)\/firebase-([a-z-]+)\.js/g;

/** @returns {{ ok: boolean, errors: string[] }} */
export function checkDist({ distDir, expectedVersion, allow = ['app', 'analytics'] }) {
  if (!existsSync(distDir)) return { ok: false, errors: [`${distDir} does not exist`] };
  // Sourcemaps are not runtime code, so only *.js is scanned.
  const files = readdirSync(distDir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.js') && statSync(join(distDir, name)).isFile());
  if (files.length === 0) return { ok: false, errors: [`${distDir} contains no .js file`] };

  const errors = [];
  const found = new Set();
  for (const name of files) {
    const text = readFileSync(join(distDir, name), 'utf8');
    if (text.includes('@firebase/')) {
      errors.push(`${name} contains bundled @firebase/ code (an import bypassed the CDN plugin)`);
    }
    for (const [, version, module] of text.matchAll(CDN_URL)) {
      found.add(module);
      if (version !== expectedVersion) {
        errors.push(`${name} loads firebase ${version}, but ${expectedVersion} is installed`);
      }
      if (!allow.includes(module)) {
        errors.push(`${name} loads firebase/${module}, which is not allowed (${allow.join(', ')})`);
      }
    }
  }
  for (const module of allow) {
    if (!found.has(module)) errors.push(`no CDN import of firebase/${module} found in dist`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const distDir = argValue(args, '--dist') ?? fileURLToPath(new URL('../dist', import.meta.url));
  const expectedVersion =
    argValue(args, '--expected-version') ??
    createRequire(import.meta.url)('firebase/package.json').version;
  const allow = ['app', 'analytics'];
  const result = checkDist({ distDir, expectedVersion, allow });
  if (result.ok) {
    console.log(`check-cdn: OK (firebase ${expectedVersion}: ${allow.join(', ')})`);
  } else {
    for (const error of result.errors) console.error(`check-cdn: ${error}`);
    process.exitCode = 1;
  }
}
