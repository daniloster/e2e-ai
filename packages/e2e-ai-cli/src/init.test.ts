import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contextFromDocs, loadConfig, loadGlobals, loadRoutines, parseFeature } from '@pn/e2e-ai';

import { applyInit, DEFAULTS, parseIntegrations, planInit, type InitOptions } from './init.ts';

const opts = (o: Partial<InitOptions>): InitOptions => ({ project: '.', dir: 'e2e', integrations: ['web'], ...DEFAULTS, ...o });

/** Loads a generated suite the way `e2e-ai run` does; throws on anything the runner would reject. */
function load(configPath: string) {
  const cfg = loadConfig(configPath);
  const context = contextFromDocs({
    apiDocs: cfg.docs.api.map((f) => ({ md: readFileSync(f, 'utf8'), file: f })),
    guide: { md: readFileSync(cfg.docs.guide, 'utf8'), file: cfg.docs.guide },
    baseUrl: cfg.api.baseUrl,
  });
  const features = readdirSync(cfg.features).map((f) => join(cfg.features, f));
  const globals = loadGlobals(features);
  const scenarios = globals.features.flatMap((f) => parseFeature(readFileSync(f, 'utf8'), f));
  const routines = loadRoutines(cfg.routines);
  return { cfg, context, globals, scenarios, routines };
}

describe('e2e-ai init', () => {
  it('sets up a whole repo ("global") with a loadable suite, scripts and editor recommendation', () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-init-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'shop', scripts: { test: 'vitest' } }));
    const o = opts({ ci: 'github' });
    applyInit(root, o, planInit(o), false, () => undefined);
    const { cfg, context, globals, scenarios, routines } = load(join(root, 'e2e/e2e-ai.config.json'));
    expect(Object.keys(cfg.targets)).toEqual(['web']);
    expect(context.pockets[0]?.data).toBeDefined();
    expect(scenarios.map((s) => s.name)).toEqual(['The right password signs in', 'A wrong password is rejected']);
    expect(globals.rules).toEqual([]); // the globals file ships with commented examples only
    expect(routines.defs.map((d) => d.signature)).toEqual(['create user with login "${email}" and password "${password}"']);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts).toMatchObject({ test: 'vitest', e2e: 'e2e-ai run --config e2e/e2e-ai.config.json', 'e2e:replay': 'e2e-ai run --config e2e/e2e-ai.config.json --replay' });
    expect(readFileSync(join(root, '.vscode/extensions.json'), 'utf8')).toContain('pocketnotes.e2e-ai-vscode');
    expect(readFileSync(join(root, '.github/workflows/e2e.yml'), 'utf8')).toContain('--replay --shard');
    expect(readFileSync(join(root, 'e2e/README.md'), 'utf8')).toContain('npm run e2e:doctor');
  });

  it('sets up inside one app of a monorepo, with mobile integrations', () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-init-'));
    const o = opts({ project: 'apps/mobile', integrations: parseIntegrations('android-appium,ios-maestro'), appId: 'com.shop.dev', scheme: 'shop' });
    applyInit(root, o, planInit(o), false, () => undefined);
    const { cfg } = load(join(root, 'apps/mobile/e2e/e2e-ai.config.json'));
    expect(Object.keys(cfg.targets)).toEqual(['android-appium', 'ios-maestro']);
    expect(cfg.targets['android-appium']?.driver).toMatchObject({ type: 'appium', appId: 'com.shop.dev', scheme: 'shop' });
    const pkg = JSON.parse(readFileSync(join(root, 'apps/mobile/package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.e2e).toBe('e2e-ai run --config e2e/e2e-ai.config.json');
  });

  it('keeps existing files and scripts unless forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-init-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { e2e: 'custom' } }));
    const o = opts({});
    applyInit(root, o, planInit(o), false, () => undefined);
    writeFileSync(join(root, 'e2e/docs/api.md'), '# mine');
    const lines: string[] = [];
    applyInit(root, o, planInit(o), false, (l) => lines.push(l));
    expect(readFileSync(join(root, 'e2e/docs/api.md'), 'utf8')).toBe('# mine');
    expect(lines).toContain('exists e2e/docs/api.md');
    expect((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts.e2e).toBe('custom');
  });

  it('rejects unknown integrations', () => {
    expect(() => parseIntegrations('web,saucelabs')).toThrow(/unknown integration "saucelabs"/);
  });
});
