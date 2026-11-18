// Writes a target's FileMap under a root and reports drift without writing. Only the
// map's own paths are ever touched, and every key is checked to stay inside the root.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { BrandTarget, Drift, FileMap } from './types';

function assertSafeKeys(files: FileMap): void {
  for (const key of files.keys()) {
    const segments = key.split('/');
    const unsafe =
      key === '' ||
      key.startsWith('/') ||
      key.includes('\\') ||
      key.includes(':') ||
      segments.some((s) => s === '' || s === '.' || s === '..');
    if (unsafe) throw new RangeError(`unsafe output path "${key}"`);
  }
}

function toDiskPath(root: string, key: string): string {
  return join(root, ...key.split('/'));
}

function expectedBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

/** The file's bytes, null when it does not exist, 'directory' when a directory is in the way. */
function readIfExists(path: string): Uint8Array | null | 'directory' {
  try {
    if (statSync(path).isDirectory()) return 'directory';
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameBytes(found: Uint8Array | null | 'directory', expected: Uint8Array): boolean {
  return found instanceof Uint8Array && Buffer.compare(found, expected) === 0;
}

/** Writes missing or different files in insertion order; creates parent dirs; returns files written. */
export function writeFiles(root: string, files: FileMap): number {
  assertSafeKeys(files);
  let written = 0;
  for (const [key, value] of files) {
    const path = toDiskPath(root, key);
    const bytes = expectedBytes(value);
    if (sameBytes(readIfExists(path), bytes)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    written += 1;
  }
  return written;
}

/** Builds the target once and compares every owned path with the disk; writes nothing. */
export function checkTarget(root: string, target: BrandTarget): Drift {
  const files = target.build(root);
  assertSafeKeys(files);
  const drift: Drift = { missing: [], changed: [] };
  for (const [key, value] of files) {
    const found = readIfExists(toDiskPath(root, key));
    if (found === null) drift.missing.push(key);
    else if (!sameBytes(found, expectedBytes(value))) drift.changed.push(key);
  }
  return drift;
}
