// Playwright Test integration: Playwright runs the features; this engine plans each Gherkin step and
// drives Playwright's own `page` (fixtures, projects, retries, trace, video, HTML report and sharding
// all stay Playwright's). Generated once by `e2e-ai playwright init`:
//
//   // e2e/playwright/features.spec.ts
//   import { test } from '@playwright/test';
//   import { defineFeatureTests } from '@pn/e2e-ai/playwright';
//   defineFeatureTests(test, { config: 'e2e/e2e-ai.config.json' });
//
// Each scenario is a test (tags → Playwright tags, so `--grep @smoke` works), each step a
// `test.step`, each step's screenshot an attachment. Replay-only with E2E_REPLAY=1 (CI).
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Page, TestInfo, TestType } from '@playwright/test';

import { openPlanCache } from './cache.ts';
import { buildCatalog } from './catalog.ts';
import { loadConfig } from './config.ts';
import { matchesTags } from './dialect.ts';
import { contextFromDocs } from './docs.ts';
import { withRoutes } from './drivers/index.ts';
import { SNAPSHOT_FN } from './drivers/web.ts';
import { parseFeature } from './gherkin.ts';
import { createLlm } from './llm.ts';
import { loadGlobals } from './globals.ts';
import { loadRoutines } from './routines.ts';
import { runScenario } from './runner.ts';
import type { Driver, UiElement } from './types.ts';

/** A Driver on top of a Playwright `page` that Playwright Test owns (one fresh context per test). */
export function createPageDriver(page: Page, opts: { baseUrl: string; startPath?: string }): Driver {
  const url = (t: string) => new URL(t, opts.baseUrl).toString();
  return {
    platform: 'web',
    name: 'playwright-test',
    async start() {},
    async stop() {},
    async resetApp() {
      await page.goto(url(opts.startPath ?? '/'));
    },
    async openRoute() {
      throw new Error('page driver opens routes through navigate(target)');
    },
    async navigate(target) {
      await page.goto(url(target));
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    },
    snapshot: async () => (await page.evaluate(SNAPSHOT_FN)) as UiElement[],
    tap: async (ref) => page.locator(`[data-e2e-ref="${ref}"]`).click({ timeout: 2000 }),
    fill: async (ref, text) => page.locator(`[data-e2e-ref="${ref}"]`).fill(text, { timeout: 2000 }),
    screenshot: async (path) => void (await page.screenshot({ path })),
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : n.endsWith('.feature') ? [p] : [];
    });
}

export interface FeatureTestOptions {
  config?: string;
  /** Which config target supplies baseUrl/startPath (a web target with a playwright-mcp/mcp driver), or set them directly. */
  baseUrl?: string;
  startPath?: string;
  tags?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Playwright `test` (extended fixtures included)
export function defineFeatureTests(test: TestType<any, any>, opts: FeatureTestOptions = {}): void {
  const cfg = loadConfig(opts.config ?? process.env.E2E_CONFIG ?? 'e2e/e2e-ai.config.json');
  const context = contextFromDocs({
    apiDocs: cfg.docs.api.map((f) => ({ md: readFileSync(f, 'utf8'), file: relative(process.cwd(), f) })),
    guide: { md: readFileSync(cfg.docs.guide, 'utf8'), file: relative(process.cwd(), cfg.docs.guide) },
    baseUrl: cfg.api.baseUrl,
  });
  const routines = loadRoutines(cfg.routines);
  const routes = buildCatalog(context).routes;
  const webTarget = Object.values(cfg.targets).find((t) => t.platform === 'web');
  const d = webTarget?.driver as { baseUrl?: string; startPath?: string } | undefined;
  const baseUrl = opts.baseUrl ?? process.env.E2E_BASE_URL ?? d?.baseUrl ?? 'http://localhost:5180';
  const startPath = opts.startPath ?? d?.startPath ?? '/';
  const replay = process.env.E2E_REPLAY === '1';
  const tags = opts.tags ?? process.env.E2E_TAGS;

  const { features, rules: globals } = loadGlobals(walk(cfg.features));
  for (const file of features) {
    const uri = relative(process.cwd(), file);
    const scenarios = parseFeature(readFileSync(file, 'utf8'), uri).filter((s) => matchesTags(s.tags, tags) && !s.tags.includes('#skip-web'));
    if (scenarios.length === 0) continue;
    test.describe(scenarios[0]?.feature ?? uri, () => {
      for (const sc of scenarios) {
        test(
          sc.rule && /^Background \d+$/.test(sc.rule) ? `${sc.name}` : sc.name,
          { tag: sc.tags.map((t) => t.replace(/^#/, '@')), annotation: [{ type: 'feature file', description: `${uri}:${sc.line ?? ''}` }] },
          async ({ page }: { page: Page }, testInfo: TestInfo) => {
            const driver = withRoutes(createPageDriver(page, { baseUrl, startPath }), 'web', routes);
            const llm = replay ? undefined : createLlm(cfg.model);
            const shots = join(testInfo.outputDir, 'steps');
            const r = await runScenario(sc, {
              context,
              driver,
              routines,
              globals,
              cache: openPlanCache(cfg.plans),
              screenshots: { dir: shots, rel: shots, mode: 'steps' },
              ...(llm ? { llm } : {}),
              wrapStep: (title, run, report) =>
                test.step(title, async () => {
                  try {
                    await run();
                  } finally {
                    if (report.screenshot) await testInfo.attach(title, { path: report.screenshot, contentType: 'image/png' });
                  }
                }),
            });
            const failed = r.steps.find((s) => s.status === 'failed');
            if (failed) throw new Error(`${failed.step}: ${failed.error ?? 'failed'}${failed.line ? ` (${uri}:${failed.line})` : ''}`);
          },
        );
      }
    });
  }
}
