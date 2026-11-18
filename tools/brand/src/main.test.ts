import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { USAGE } from './cli';
import { main } from './main';
import { readPngInfo } from './png';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pn-brand-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function capture(): { lines: string[]; print: (line: string) => void } {
  const lines: string[] = [];
  return { lines, print: (line) => lines.push(line) };
}

function snapshot(root: string): [string, number][] {
  return (readdirSync(root, { recursive: true }) as string[])
    .sort()
    .map((p) => [p, statSync(join(root, p)).mtimeMs]);
}

describe('main', () => {
  it(
    'reports every file missing in an empty root and writes nothing',
    { timeout: 60_000 },
    async () => {
      const root = tempRoot();
      const out = capture();
      expect(await main(['--check', '--targets', 'icons', '--root', root], out.print)).toBe(1);
      expect(out.lines[0]).toBe('icons: drift (0 changed, 35 missing)');
      expect(out.lines.filter((l) => l.startsWith('  missing '))).toHaveLength(35);
      expect(out.lines.at(-1)).toBe('run "npm run brand" to regenerate');
      expect(readdirSync(root)).toEqual([]);
    },
  );

  it('writes every default target, then finds them up to date', { timeout: 120_000 }, async () => {
    const root = tempRoot();
    const write = capture();
    expect(await main(['--root', root], write.print)).toBe(0);
    expect(write.lines).toEqual([
      'icons: 35 files, 35 written',
      'splash: 28 files, 28 written',
      'site: 6 files, 6 written',
      'ui: 25 files, 25 written',
    ]);
    const check = capture();
    expect(await main(['--check', '--root', root], check.print)).toBe(0);
    expect(check.lines).toEqual([
      'icons: up to date (35 files)',
      'splash: up to date (28 files)',
      'site: up to date (6 files)',
      'ui: up to date (25 files)',
    ]);
    const again = capture();
    await main(['--root', root], again.print);
    expect(again.lines[0]).toBe('icons: 35 files, 0 written');
  });

  it('reports a changed file and touches nothing in check mode', { timeout: 60_000 }, async () => {
    const root = tempRoot();
    await main(['--targets', 'splash', '--root', root], () => undefined);
    const path = 'apps/mobile/android/app/src/main/res/values/bootsplash.xml';
    writeFileSync(join(root, path), 'edited by hand');
    const before = snapshot(root);
    const out = capture();
    expect(await main(['--check', '--targets', 'splash', '--root', root], out.print)).toBe(1);
    expect(out.lines).toContain(`  changed ${path}`);
    expect(snapshot(root)).toEqual(before);
  });

  it('writes the preview only under tools/brand/out', { timeout: 60_000 }, async () => {
    const root = tempRoot();
    const out = capture();
    expect(await main(['--preview', '--targets', 'site', '--root', root], out.print)).toBe(0);
    expect(out.lines.at(-1)).toBe('preview: tools/brand/out/preview.png');
    const preview = readFileSync(join(root, 'tools/brand/out/preview.png'));
    expect(readPngInfo(preview).width).toBe(1280);
  });

  it('answers usage errors with exit code 2 and the usage line', async () => {
    const out = capture();
    expect(await main(['--bogus'], out.print)).toBe(2);
    expect(out.lines[0]).toContain('"--bogus"');
    expect(out.lines[1]).toBe(USAGE);
    expect(await main(['--check', '--preview'], () => undefined)).toBe(2);
  });

  it('has no side effect on import', () => {
    expect(process.exitCode).toBeUndefined();
  });
});
