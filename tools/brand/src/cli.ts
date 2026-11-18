// pn-brand argument parsing: defaults first, a switch over
// the flag, anything else is an error naming it. Throws instead of returning a result object.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_TARGET_IDS, TARGET_IDS } from './targets';
import type { TargetId } from './types';

export interface CliOptions {
  /** Default: every target, in registry order. */
  targets: readonly TargetId[];
  /** --check: compare, write nothing, exit 1 on drift. */
  check: boolean;
  /** --preview: also write tools/brand/out/preview.png. */
  preview: boolean;
  /** Repo root; default resolved from the tool's location. */
  root: string;
  /** --help / -h. */
  help: boolean;
}

export const USAGE =
  'usage: pn-brand [--targets icons,splash,site,ui] [--check] [--preview] [--root <dir>] [--help]';

/** The repository root, from this file's location (never the current directory). */
export const DEFAULT_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function parseTargets(value: string): readonly TargetId[] {
  const items = value.split(',');
  if (items.some((item) => item === '')) throw new Error('--targets: empty target in the list');
  for (const item of items) {
    if (!(TARGET_IDS as readonly string[]).includes(item)) {
      throw new Error(`unknown target "${item}"`);
    }
  }
  return Object.freeze(TARGET_IDS.filter((id) => items.includes(id)));
}

/** Throws an Error naming the bad flag or target. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    targets: DEFAULT_TARGET_IDS,
    check: false,
    preview: false,
    root: DEFAULT_ROOT,
    help: false,
  };
  const value = (i: number, flag: string): string => {
    const next = argv[i + 1];
    if (next === undefined) throw new Error(`${flag}: missing value`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    switch (arg) {
      case '--targets':
        options.targets = parseTargets(value(i, arg));
        i += 1;
        break;
      case '--root':
        options.root = resolve(value(i, arg));
        i += 1;
        break;
      case '--check':
        options.check = true;
        break;
      case '--preview':
        options.preview = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`unknown flag "${arg}"`);
    }
  }
  if (options.check && options.preview) {
    throw new Error('--check and --preview cannot be combined: check mode writes nothing');
  }
  return options;
}
