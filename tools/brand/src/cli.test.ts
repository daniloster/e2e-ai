import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ROOT, parseArgs, USAGE } from './cli';

describe('parseArgs', () => {
  it('defaults to every target, write mode, the repo root', () => {
    expect(parseArgs([])).toEqual({
      targets: ['icons', 'splash', 'site', 'ui'],
      check: false,
      preview: false,
      root: DEFAULT_ROOT,
      help: false,
    });
  });

  it('selects targets in registry order without duplicates', () => {
    expect(parseArgs(['--targets', 'icons']).targets).toEqual(['icons']);
    expect(parseArgs(['--targets', 'splash,icons,splash']).targets).toEqual(['icons', 'splash']);
    expect(parseArgs(['--targets', 'site']).targets).toEqual(['site']);
    expect(parseArgs(['--targets', 'site,icons']).targets).toEqual(['icons', 'site']);
    expect(parseArgs(['--targets', 'ui,icons']).targets).toEqual(['icons', 'ui']);
    expect(Object.isFrozen(parseArgs(['--targets', 'icons']).targets)).toBe(true);
  });

  it('reads the mode flags and the root', () => {
    expect(parseArgs(['--check']).check).toBe(true);
    expect(parseArgs(['--preview']).preview).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--root', 'some/dir']).root).toBe(resolve('some/dir'));
  });

  it('defaults the root to the repository', () => {
    expect(existsSync(join(DEFAULT_ROOT, 'ARCHITECTURE.md'))).toBe(true);
    expect(existsSync(join(DEFAULT_ROOT, 'tools/brand/package.json'))).toBe(true);
  });

  it.each([
    [['--bogus'], '"--bogus"'],
    [['--targets', 'logo'], '"logo"'],
    [['--targets', 'icons,'], '--targets'],
    [['--targets'], '--targets'],
    [['--root'], '--root'],
    [['--root=x'], '"--root=x"'],
    [['--check', '--preview'], '--check and --preview'],
    [['--help', '--bogus'], '"--bogus"'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('USAGE', () => {
  it('names the command and every flag', () => {
    expect(USAGE.startsWith('usage: pn-brand')).toBe(true);
    for (const flag of ['--targets', '--check', '--preview', '--root', '--help']) {
      expect(USAGE).toContain(flag);
    }
    expect(USAGE).toContain('icons,splash,site,ui');
  });
});
