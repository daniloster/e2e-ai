import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { checkTarget, writeFiles } from './fsio';
import { TARGETS } from './targets';
import type { BrandTarget, FileMap } from './types';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pn-brand-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fake(files: FileMap): BrandTarget {
  return { id: 'icons', build: () => files };
}
const SMALL: FileMap = new Map<string, Uint8Array | string>([
  ['a/b.txt', 'x'],
  ['a/c.bin', new Uint8Array([1, 2, 3])],
]);

describe('writeFiles and checkTarget', () => {
  it('round-trips both real targets', { timeout: 60_000 }, () => {
    for (const target of [TARGETS.icons, TARGETS.splash]) {
      const root = tempRoot();
      const files = target.build(root);
      expect(writeFiles(root, files)).toBe(files.size);
      expect(checkTarget(root, target)).toEqual({ missing: [], changed: [] });
    }
  });

  it('reports a changed and a missing file', () => {
    const root = tempRoot();
    writeFiles(root, SMALL);
    writeFileSync(join(root, 'a/c.bin'), new Uint8Array([1, 2, 4]));
    expect(checkTarget(root, fake(SMALL))).toEqual({ missing: [], changed: ['a/c.bin'] });
    unlinkSync(join(root, 'a/b.txt'));
    expect(checkTarget(root, fake(SMALL)).missing).toEqual(['a/b.txt']);
  });

  it('never touches a file outside the map', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'a/foreign.txt'), 'mine');
    const before = statSync(join(root, 'a/foreign.txt')).mtimeMs;
    writeFiles(root, SMALL);
    expect(readFileSync(join(root, 'a/foreign.txt'), 'utf8')).toBe('mine');
    expect(statSync(join(root, 'a/foreign.txt')).mtimeMs).toBe(before);
    const drift = checkTarget(root, fake(SMALL));
    expect([...drift.missing, ...drift.changed]).not.toContain('a/foreign.txt');
  });

  it('writes nothing the second time and keeps mtimes', () => {
    const root = tempRoot();
    expect(writeFiles(root, SMALL)).toBe(2);
    const mtimes = [...SMALL.keys()].map((k) => statSync(join(root, k)).mtimeMs);
    expect(writeFiles(root, SMALL)).toBe(0);
    expect([...SMALL.keys()].map((k) => statSync(join(root, k)).mtimeMs)).toEqual(mtimes);
    expect(checkTarget(root, fake(SMALL))).toEqual({ missing: [], changed: [] });
  });

  it('lists everything as missing on an empty root and creates nothing', () => {
    const root = tempRoot();
    expect(checkTarget(root, fake(SMALL))).toEqual({
      missing: ['a/b.txt', 'a/c.bin'],
      changed: [],
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it('reports a directory in the way as changed', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'a/b.txt'), { recursive: true });
    expect(checkTarget(root, fake(SMALL)).changed).toContain('a/b.txt');
  });

  it('refuses paths that could leave the root, before writing anything', () => {
    for (const bad of ['../escape.txt', '/abs.txt', 'a//b.txt', 'a\\b.txt', './a.txt', '']) {
      const root = tempRoot();
      const files = new Map([
        ['ok.txt', 'x'],
        [bad, 'y'],
      ]);
      expect(() => writeFiles(root, files)).toThrow(RangeError);
      expect(() => writeFiles(root, files)).toThrow(bad === '' ? '""' : bad);
      expect(readdirSync(root)).toEqual([]);
    }
  });

  it('builds the target once per check', () => {
    const build = vi.fn(() => SMALL);
    checkTarget(tempRoot(), { id: 'icons', build });
    expect(build).toHaveBeenCalledTimes(1);
  });
});
