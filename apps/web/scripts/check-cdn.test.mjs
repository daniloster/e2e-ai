// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { checkDist } from './check-cdn.mjs';

const SCRIPT = fileURLToPath(new URL('./check-cdn.mjs', import.meta.url));
const url = (version, module) =>
  `https://www.gstatic.com/firebasejs/${version}/firebase-${module}.js`;
const CLEAN = `Promise.all([import(\`${url('12.19.0', 'app')}\`),import("${url('12.19.0', 'analytics')}")]);`;

const dirs = [];

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'check-cdn-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const check = (distDir, expectedVersion = '12.19.0') => checkDist({ distDir, expectedVersion });

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('checkDist', () => {
  it('accepts a clean build', () => {
    expect(
      check(fixture({ 'assets/index.js': CLEAN, 'assets/index.js.map': '"@firebase/app"' })),
    ).toEqual({
      ok: true,
      errors: [],
    });
  });

  it('rejects bundled @firebase code', () => {
    const result = check(
      fixture({ 'assets/index.js': CLEAN, 'assets/vendor.js': 'var x="@firebase/app";' }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('vendor.js');
  });

  it('rejects a version that differs from the installed one', () => {
    const result = check(fixture({ 'index.js': CLEAN }), '12.20.0');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('12.19.0');
    expect(result.errors[0]).toContain('12.20.0');
  });

  it('rejects a module outside the allow-list', () => {
    const result = check(
      fixture({ 'index.js': `${CLEAN}import("${url('12.19.0', 'firestore')}")` }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('firebase/firestore');
  });

  it('rejects a missing dist and a dist without JS', () => {
    expect(check(join(tmpdir(), 'check-cdn-missing-dir')).ok).toBe(false);
    expect(check(fixture({ 'index.html': '<html></html>' })).ok).toBe(false);
  });

  it('requires every allowed module to be imported', () => {
    const result = check(fixture({ 'index.js': `import("${url('12.19.0', 'app')}")` }));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['no CDN import of firebase/analytics found in dist']);
  });
});

describe('check-cdn CLI', () => {
  const run = (dist, version) =>
    spawnSync(process.execPath, [SCRIPT, '--dist', dist, '--expected-version', version], {
      encoding: 'utf8',
    });

  it('prints OK and exits 0 on a clean build', () => {
    const result = run(fixture({ 'index.js': CLEAN }), '12.19.0');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('check-cdn: OK (firebase 12.19.0: app, analytics)');
  });

  it('prints errors and exits 1 on a version mismatch', () => {
    const result = run(fixture({ 'index.js': CLEAN }), '12.20.0');
    expect(result.status).toBe(1);
    expect(result.stderr.startsWith('check-cdn: ')).toBe(true);
  });
});
