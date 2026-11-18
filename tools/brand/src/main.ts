// pn-brand entry: write the selected targets, check them for drift, or also write the
// preview sheet. Exported for tests; it runs only when this module is the process entry.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseArgs, USAGE } from './cli';
import type { CliOptions } from './cli';
import { checkTarget, writeFiles } from './fsio';
import { buildPreviewSheet, PREVIEW_PATH } from './preview';
import { TARGETS } from './targets';

type Print = (line: string) => void;

function defaultPrint(line: string): void {
  process.stdout.write(`${line}\n`);
}

function writeMode(options: CliOptions, print: Print): number {
  for (const id of options.targets) {
    const files = TARGETS[id].build(options.root);
    const written = writeFiles(options.root, files);
    print(`${id}: ${files.size} files, ${written} written`);
  }
  if (options.preview) {
    writeFiles(options.root, new Map([[PREVIEW_PATH, buildPreviewSheet()]]));
    print(`preview: ${PREVIEW_PATH}`);
  }
  return 0;
}

function checkMode(options: CliOptions, print: Print): number {
  let drifted = false;
  for (const id of options.targets) {
    // Build once: the count and the comparison come from the same render.
    const files = TARGETS[id].build(options.root);
    const { missing, changed } = checkTarget(options.root, { id, build: () => files });
    if (missing.length === 0 && changed.length === 0) {
      print(`${id}: up to date (${files.size} files)`);
      continue;
    }
    drifted = true;
    print(`${id}: drift (${changed.length} changed, ${missing.length} missing)`);
    for (const path of changed) print(`  changed ${path}`);
    for (const path of missing) print(`  missing ${path}`);
  }
  if (drifted) print('run "npm run brand" to regenerate');
  return drifted ? 1 : 0;
}

/** True when this module is the process entry; npm runs bins through symlinks, hence realpath. */
function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

/** Exit code: 0 ok, 1 drift in --check, 2 usage error. */
export async function main(argv: readonly string[], print: Print = defaultPrint): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    print((error as Error).message);
    print(USAGE);
    return 2;
  }
  if (options.help) {
    print(USAGE);
    return 0;
  }
  try {
    return options.check ? checkMode(options, print) : writeMode(options, print);
  } catch (error) {
    // A target that cannot build explains itself; exit 2 like usage.
    print((error as Error).message);
    return 2;
  }
}

if (isEntry()) process.exitCode = await main(process.argv.slice(2));
