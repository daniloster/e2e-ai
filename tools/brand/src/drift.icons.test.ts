// The committed icons files match the generator: a red test here means someone edited a generated
// file by hand or changed the mark without regenerating. The temp-copy checks run on freshly
// written files.
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_ROOT } from './cli';
import { checkTarget, writeFiles } from './fsio';
import { TARGETS } from './targets';

const HINT = 'run "npm run brand -- --targets icons" and commit the result';

describe('icons drift', () => {
  it('the committed icons files match the generator', { timeout: 120_000 }, () => {
    expect(checkTarget(DEFAULT_ROOT, TARGETS.icons), HINT).toEqual({ missing: [], changed: [] });
  });

  describe('in a temp copy', () => {
    let tmp = '';
    let paths: string[] = [];
    beforeAll(() => {
      tmp = mkdtempSync(join(tmpdir(), 'pn-brand-'));
      const files = TARGETS.icons.build(tmp);
      paths = [...files.keys()];
      writeFiles(tmp, files);
    }, 120_000);
    afterAll(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('reports hand-edited and deleted files', { timeout: 120_000 }, () => {
      expect(checkTarget(tmp, TARGETS.icons)).toEqual({ missing: [], changed: [] });
      const png = paths.find((p) => p.endsWith('.png')) ?? '';
      const textFile = paths.find((p) => !p.endsWith('.png')) ?? '';
      const bytes = readFileSync(join(tmp, png));
      bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 0xff;
      writeFileSync(join(tmp, png), bytes);
      writeFileSync(join(tmp, textFile), `${readFileSync(join(tmp, textFile), 'utf8')} `);
      const changed = checkTarget(tmp, TARGETS.icons).changed;
      expect([...changed].sort()).toEqual([png, textFile].sort());
      unlinkSync(join(tmp, png));
      expect(checkTarget(tmp, TARGETS.icons).missing).toEqual([png]);
    });
  });
});
