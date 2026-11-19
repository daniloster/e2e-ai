#!/usr/bin/env node
// e2e-ai — the command line of @pn/e2e-ai. Devs write .feature, .routine and Markdown docs; this runs them.
//
//   e2e-ai run    [--config e2e/e2e-ai.config.json] [--target web|ios] [--replay] [--tags "#a,!#b"]
//                 [--template engineering,executive] [--model '"name"@endpoint'] [--screenshots steps|failures|none]
//                 [--video mobile|all|none]
//                 [--benchmark ['"m1"@http://host:port/v1;"m2"@http://host:port/v1']]   compare models
//                 [--no-cache]   plan every step with the model, every time; never read/write plans
//                 [feature files…]            (default: every .feature under config.features)
//   e2e-ai report <run folder | report.json> [--template name,…]   re-render with other templates
//   e2e-ai doctor [--config …] [--target …]   check docs, model endpoint and MCP drivers
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { applyInit, DEFAULTS, INTEGRATIONS, parseIntegrations, planInit, type Integration, type InitOptions } from './init.ts';
import {
  benchmarkFacts,
  benchPlanner,
  buildCatalog,
  checkedText,
  collect,
  contextFromDocs,
  createDriver,
  createLlm,
  findSlots,
  loadConfig,
  loadGlobals,
  loadRoutines,
  matchesTags,
  modelInfo,
  modelResult,
  modeResult,
  openPlanCache,
  parseFeature,
  parseModelSpecs,
  recommend,
  renderBenchmarkHtml,
  rerender,
  runMaestroCloud,
  runScenario,
  startMemoryProbe,
  templateBrief,
  writeReport,
  type AppContext,
  type BenchmarkData,
  type BenchmarkMode,
  type Case,
  type Driver,
  type E2eConfig,
  type Llm,
  type ModelConfig,
  type ModelResult,
  type ModeResult,
  type PlannerBenchSummary,
  type ReportData,
  type GlobalRule,
  type RoutineLibrary,
  type ScenarioReport,
  type UiElement,
} from '@pn/e2e-ai';

const BOOLEAN_FLAGS = ['--compile-only', '--replay', '--no-ai-report', '--no-cache'];
// `--benchmark` takes a value unless the next token is another flag (then the config list is used).

function parseArgs(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && !BOOLEAN_FLAGS.includes(a)) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else files.push(a);
  }
  const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  return { flags, files, str };
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p, ext) : n.endsWith(ext) ? [p] : [];
    });
}

let lastModelError = '';

async function reachable(llm: Llm): Promise<boolean> {
  try {
    await llm.json({ system: 'Reply {"ok":true}', prompt: 'ok', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } });
    return true;
  } catch (e) {
    lastModelError = e instanceof Error ? e.message : String(e);
    // Ollama on Apple Silicon may resolve a tag to an MLX build without constrained decoding.
    if (/structured output is unavailable/i.test(lastModelError)) {
      lastModelError += ` — this build (often an MLX/nvfp4 tag) cannot do JSON-schema output; use the GGUF tag, e.g. "${llm.model.split(':')[0]}:<size>-q4_K_M"`;
    }
    return false;
  }
}

function appContext(cfg: E2eConfig): AppContext & { endpoints: { id: string }[] } {
  return contextFromDocs({
    apiDocs: cfg.docs.api.map((f) => ({ md: readFileSync(f, 'utf8'), file: relative(process.cwd(), f) })),
    guide: { md: readFileSync(cfg.docs.guide, 'utf8'), file: relative(process.cwd(), cfg.docs.guide) },
    baseUrl: cfg.api.baseUrl,
  });
}

function driverFor(cfg: E2eConfig, target: string, context: AppContext): Driver {
  const t = cfg.targets[target];
  if (!t) throw new Error(`no target "${target}" in config (have: ${Object.keys(cfg.targets).join(', ')})`);
  return createDriver(target, t, buildCatalog(context).routes);
}

function templateNames(cfg: E2eConfig, requested?: string): string[] {
  if (requested) return requested.split(',').map((s) => s.trim()).filter(Boolean);
  // Run templates are the top-level files; templates/benchmark/ holds the comparison templates.
  const all = readdirSync(cfg.reports.templates).filter((f) => f.endsWith('.html')).sort().map((f) => basename(f, '.html'));
  return [cfg.reports.defaultTemplate, ...all.filter((n) => n !== cfg.reports.defaultTemplate)];
}

/** Renders every requested template into the run folder: the first as index.html, others as <name>.html. */
async function renderTemplates(cfg: E2eConfig, data: ReportData, outDir: string, names: string[], llm: Llm | undefined): Promise<string[]> {
  const written: string[] = [];
  for (const [i, name] of names.entries()) {
    const templatePath = join(cfg.reports.templates, `${name}.html`);
    if (!existsSync(templatePath)) throw new Error(`no template ${templatePath}`);
    const copy = JSON.parse(JSON.stringify(data)) as ReportData;
    written.push(await writeReport({ templatePath, outDir, data: copy, ...(llm ? { llm } : {}), indexName: i === 0 ? 'index.html' : `${name}.html` }));
  }
  return written;
}

async function reportLlm(cfg: E2eConfig, runLlm: Llm | undefined, disabled: boolean): Promise<Llm | undefined> {
  if (disabled) return undefined;
  const candidate = cfg.reports.model ? createLlm(cfg.reports.model) : (runLlm ?? createLlm(cfg.model));
  if (await reachable(candidate)) return candidate;
  console.warn(`report: pocket model ${candidate.model} unreachable; layout and texts generated from data`);
  return undefined;
}

interface SuiteOptions {
  cfg: E2eConfig;
  target: string;
  context: AppContext;
  routines: RoutineLibrary;
  globals: GlobalRule[];
  driver: Driver;
  llm: Llm | undefined;
  cachePath: string;
  /** --no-cache: the model interprets every step every time; nothing is read or written. */
  noCache: boolean;
  /** Plan every step (never read the cache) but store the plans (benchmark no-cache mode). */
  record?: boolean;
  /** This scenario is planned from scratch even though the cache is on (benchmark one-fresh mode). */
  freshScenario?: string;
  /** --shard i/n: run every n-th scenario starting at i (1-based), for parallel CI jobs. */
  shard?: { index: number; total: number };
  /** --max-failures N: stop after N failed scenarios. */
  maxFailures?: number;
  /** --compile-only: cloud Maestro targets write their flows without running them. */
  compileOnly?: boolean;
  tags: string | undefined;
  featureFiles: string[];
  runDir: string;
  media: { screenshots: string; video: string; stepPauseMs?: number };
}

/** Runs every matching scenario once; the driver must be started. */
async function runSuite(o: SuiteOptions): Promise<ScenarioReport[]> {
  const t = o.cfg.targets[o.target];
  const screenshots = {
    dir: join(o.runDir, 'screenshots'),
    rel: 'screenshots',
    mode: o.media.screenshots as 'steps' | 'failures' | 'none',
    video: o.media.video === 'all' || (o.media.video === 'mobile' && t?.platform === 'mobile'),
    stepPauseMs: o.media.stepPauseMs ?? 600,
  };
  const cache = openPlanCache(o.cachePath, { disabled: o.noCache, ...(o.record ? { record: true } : {}) });
  const reports: ScenarioReport[] = [];
  let ordinal = 0;
  const d = t?.driver as { type?: string; appId?: string; scheme?: string; resetLink?: string; capabilities?: Record<string, unknown>; runner?: string; maestroRunner?: string[] } | undefined;
  if (t?.cloud && d?.type === 'maestro') {
    // Maestro on a cloud: each scenario runs as one flow compiled from its reviewed plans.
    const selected = o.featureFiles.flatMap((file) => {
      const rel = relative(process.cwd(), file);
      return parseFeature(readFileSync(file, 'utf8'), rel.startsWith('..') ? file : rel).filter(
        (sc) => matchesTags(sc.tags, o.tags) && !sc.tags.includes('#skip-mobile') && !sc.tags.includes(`#skip-${o.target}`),
      );
    }).filter(() => !o.shard || ordinal++ % o.shard.total === o.shard.index - 1);
    console.log(`\n${selected.length} scenarios as compiled Maestro flows on ${t.cloud.provider} (${o.target}, replay)`);
    return runMaestroCloud(selected, {
      context: o.context,
      cache,
      routines: o.routines,
      globals: o.globals,
      cloud: t.cloud,
      target: { os: t.os ?? 'android', appId: d.appId ?? '', scheme: d.scheme ?? '', ...(d.resetLink ? { resetLink: d.resetLink } : {}), capabilities: d.capabilities ?? {} },
      workDir: join(o.runDir, 'maestro-cloud'),
      ...(d.runner === 'browserstack-api' ? { runner: 'browserstack-api' as const } : {}),
      ...(d.maestroRunner ? { maestroRunner: d.maestroRunner } : {}),
      ...(o.compileOnly ? { compileOnly: true } : {}),
      log: (l) => console.log(l),
    });
  }
  for (const file of o.featureFiles) {
    const rel = relative(process.cwd(), file);
    const uri = rel.startsWith('..') ? file : rel;
    const scenarios = parseFeature(readFileSync(file, 'utf8'), uri)
      .filter((sc) => matchesTags(sc.tags, o.tags) && !sc.tags.includes(`#skip-${o.driver.platform}`) && !sc.tags.includes(`#skip-${o.target}`))
      // Shards take every n-th scenario of the whole (sorted) suite, so jobs get similar loads.
      .filter(() => {
        const mine = !o.shard || ordinal % o.shard.total === o.shard.index - 1;
        ordinal++;
        return mine;
      });
    if (scenarios.length === 0) continue;
    console.log(`\nFeature: ${scenarios[0]?.feature ?? file}  (${o.target} via ${o.driver.name}, ${o.llm ? o.llm.model : 'replay'})`);
    for (const sc of scenarios) {
      if (o.maxFailures !== undefined && reports.filter((r) => r.status === 'failed').length >= o.maxFailures) {
        console.log(`\nstopping: --max-failures ${o.maxFailures} reached`);
        return reports;
      }
      reports.push(
        await runScenario(sc, {
          context: o.context,
          driver: o.driver,
          cache,
          screenshots,
          routines: o.routines,
          globals: o.globals,
          ...(o.freshScenario && sc.name === o.freshScenario ? { bypassCache: true } : {}),
          log: (l) => console.log(l),
          ...(o.llm ? { llm: o.llm } : {}),
        }),
      );
    }
  }
  return reports;
}

function setup(args: string[]) {
  const parsed = parseArgs(args);
  const { str } = parsed;
  const cfg = loadConfig(str('config'));
  const target = str('target') ?? Object.keys(cfg.targets)[0] ?? 'web';
  const context = appContext(cfg);
  const routines = loadRoutines(cfg.routines);
  for (const d of routines.diagnostics) console.warn(`routine warning ${d.file}:${d.line} ${d.message}`);
  // @global rules always come from the whole features folder, whichever features are run.
  const globals = loadGlobals(walk(cfg.features, '.feature'));
  for (const p of globals.problems) console.warn(`global warning ${p.file}:${p.line} ${p.message}`);
  const featureFiles = loadGlobals(parsed.files.length ? parsed.files.map((f) => resolve(f)) : walk(cfg.features, '.feature')).features;
  const shardSpec = parsed.str('shard');
  const shard = shardSpec ? (/^(\d+)\/(\d+)$/.exec(shardSpec) ?? undefined) : undefined;
  if (shardSpec && (!shard || Number(shard[1]) < 1 || Number(shard[1]) > Number(shard[2]))) throw new Error(`--shard wants i/n with 1 ≤ i ≤ n (got "${shardSpec}")`);
  const media = {
    screenshots: str('screenshots') ?? cfg.media.screenshots,
    video: str('video') ?? cfg.media.video,
    ...(cfg.media.stepPauseMs !== undefined ? { stepPauseMs: cfg.media.stepPauseMs } : {}),
  };
  return {
    ...parsed,
    cfg,
    target,
    context,
    routines,
    globals: globals.rules,
    featureFiles,
    media,
    ...(shard ? { shard: { index: Number(shard[1]), total: Number(shard[2]) } } : {}),
    ...(parsed.str('max-failures') ? { maxFailures: Number(parsed.str('max-failures')) } : {}),
  };
}

async function run(args: string[]): Promise<number> {
  const startedAt = new Date();
  const s = setup(args);
  const { cfg, target, context, flags, str } = s;
  if (flags.benchmark) return benchmark(s, startedAt);
  if (flags['no-cache'] && flags.replay) throw new Error('--no-cache and --replay contradict each other (replay uses only cached plans)');
  // --model "name"@endpoint overrides the config's model (endpoint optional).
  const modelCfg: ModelConfig = str('model') ? (parseModelSpecs(str('model') as string, cfg.model)[0] as ModelConfig) : cfg.model;
  const runDir = join(cfg.reports.runs, `${stamp(startedAt)}-${target}`);
  const driver = driverFor(cfg, target, context);
  const llm = flags.replay ? undefined : createLlm(modelCfg);
  const tags = str('tags');
  let reports: ScenarioReport[] = [];
  await driver.start();
  let links: { label: string; url: string }[] = [];
  try {
    links = (await driver.links?.().catch(() => [])) ?? [];
    for (const l of links) console.log(`${l.label}: ${l.url}`);
    reports = await runSuite({ ...s, driver, llm, cachePath: cfg.plans, noCache: !!flags['no-cache'], tags, runDir, ...(flags['compile-only'] ? { compileOnly: true } : {}) });
  } finally {
    const failed = reports.filter((r) => r.status === 'failed').length;
    await driver.stop({ passed: reports.length > 0 && failed === 0, scenarios: reports.length, failed });
  }
  const data = collect(reports, {
    links,
    startedAt,
    driver: driver.name,
    platform: driver.platform,
    model: llm?.model ?? null,
    tags: tags ?? null,
    command: `e2e-ai ${process.argv.slice(2).join(' ')}`,
    llm: llm ? { ...llm.stats } : null,
    title: `${context.name} — E2E report`,
    noCache: !!flags['no-cache'],
  });
  const written = await renderTemplates(cfg, data, runDir, templateNames(cfg, str('template')), await reportLlm(cfg, llm, !!flags['no-ai-report']));
  console.log(
    `\n${data.totals.passed}/${data.totals.scenarios} scenarios passed · ${data.totals.steps} steps (${data.totals.fromModel} planned by ${llm?.model ?? '-'}, ${data.totals.fromCache} from cache)` +
      (llm ? ` · model ${llm.stats.calls} calls, ${Math.round(llm.stats.ms)}ms` : ''),
  );
  for (const w of written) console.log(`report: ${relative(process.cwd(), w)}`);
  const junit = str('junit');
  if (junit) {
    mkdirSync(dirname(resolve(junit)), { recursive: true });
    writeFileSync(resolve(junit), toJUnit(reports, target));
    console.log(`junit: ${relative(process.cwd(), resolve(junit))}`);
  }
  return data.totals.failed === 0 ? 0 : 1;
}

const xml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JUnit XML (one testsuite per feature file, one testcase per scenario) for any CI system. */
export function toJUnit(reports: ScenarioReport[], target: string): string {
  const byFile = new Map<string, ScenarioReport[]>();
  for (const r of reports) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const suites = [...byFile.entries()].map(([file, rs]) => {
    const failures = rs.filter((r) => r.status === 'failed').length;
    const cases = rs.map((r) => {
      const failed = r.steps.find((st) => st.status === 'failed');
      const steps = r.steps.map((st) => `${st.status === 'passed' ? '✓' : st.status === 'failed' ? '✗' : '-'} ${st.step}`).join('\n');
      return `    <testcase classname="${xml(`${target}.${r.feature}`)}" name="${xml(r.name)}" file="${xml(file)}" line="${r.line ?? 0}" time="${(r.ms / 1000).toFixed(3)}">${
        failed ? `\n      <failure message="${xml(failed.error ?? 'failed')}" type="StepFailure">${xml(`${failed.step}${failed.line ? ` (${file}:${failed.line})` : ''}\n${failed.error ?? ''}`)}</failure>` : ''
      }\n      <system-out>${xml(steps)}</system-out>\n    </testcase>`;
    });
    return `  <testsuite name="${xml(rs[0]?.feature ?? file)}" file="${xml(file)}" tests="${rs.length}" failures="${failures}" time="${(rs.reduce((n, r) => n + r.ms, 0) / 1000).toFixed(3)}">\n${cases.join('\n')}\n  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="e2e-ai ${xml(target)}" tests="${reports.length}" failures="${reports.filter((r) => r.status === 'failed').length}">\n${suites.join('\n')}\n</testsuites>\n`;
}

const safeName = (n: string) => n.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-|-$/g, '');

/** Every model plans the whole suite from scratch; then the planner benchmark; then the comparison. */
async function benchmark(s: ReturnType<typeof setup>, startedAt: Date): Promise<number> {
  const { cfg, target, context, flags, str } = s;
  // `--benchmark` alone = the config's benchmark.models; `--benchmark '"m"@url;…'` = that list.
  const spec = str('benchmark') ?? cfg.benchmark?.models.join(';');
  if (!spec) throw new Error('--benchmark needs models ("name"@endpoint;…) or benchmark.models in the config');
  const models = parseModelSpecs(spec, cfg.model);
  const benchDir = join(cfg.reports.runs, `${stamp(startedAt)}-${target}-benchmark`);
  const tags = str('tags');
  const driver = driverFor(cfg, target, context);
  const reportModel = await reportLlm(cfg, undefined, !!flags['no-ai-report']);
  const cases: { set: string; cases: Case[] }[] = (cfg.bench?.cases ?? []).filter(existsSync).map((f) => ({
    set: basename(f, '.json'),
    cases: JSON.parse(readFileSync(f, 'utf8')) as Case[],
  }));
  const snapshots = cfg.bench && existsSync(cfg.bench.snapshots) ? (JSON.parse(readFileSync(cfg.bench.snapshots, 'utf8')) as Record<string, UiElement[]>) : {};
  const results: ModelResult[] = [];
  await driver.start();
  try {
    for (const m of models) {
      console.log(`\n━━ benchmark: ${m.name} @ ${m.endpoint}`);
      const llm = createLlm(m);
      const info = await modelInfo(m);
      const modelDir = join(benchDir, 'models', safeName(m.name));
      const link = `models/${safeName(m.name)}/index.html`;
      if (!(await reachable(llm))) {
        results.push(modelResult(m, info, [], llm.stats, 0, link, [], lastModelError || `endpoint ${m.endpoint} did not answer for ${m.name}`));
        continue;
      }
      const cachePath = join(modelDir, 'plans.json');
      rmSync(cachePath, { force: true });
      // Modes (benchmark.modes / --modes): no-cache records the model's own plans without reading any;
      // cache replays them; one-fresh replays them except one scenario, planned from scratch.
      const modes = (str('modes')?.split(',') ?? cfg.benchmark?.modes ?? (flags['no-cache'] ? ['no-cache'] : ['no-cache', 'cache', 'one-fresh'])) as BenchmarkMode[];
      const modeResults: ModeResult[] = [];
      let reports: ScenarioReport[] = [];
      let suiteStats = { ...llm.stats };
      let duration = 0;
      let fresh = str('fresh-scenario') ?? cfg.benchmark?.freshScenario;
      for (const mode of modes) {
        const dir = join(modelDir, mode);
        const before = { ...llm.stats };
        // --memory-docker container[@context] (or benchmark.memoryProbe) samples the container's RAM too.
        const md = str('memory-docker');
        const docker = md ? { container: md.split('@')[0] as string, ...(md.includes('@') ? { context: md.split('@')[1] as string } : {}) } : cfg.benchmark?.memoryProbe;
        const probe = startMemoryProbe({ endpoint: m.endpoint, model: m.name, ...(docker ? { docker } : {}) });
        const t0 = Date.now();
        const rs = await runSuite({
          ...s,
          driver,
          llm,
          cachePath,
          noCache: false,
          record: mode === 'no-cache',
          ...(mode === 'one-fresh' && fresh ? { freshScenario: fresh } : {}),
          tags,
          runDir: dir,
        });
        const took = Date.now() - t0;
        const memory = await probe.stop();
        // Default fresh scenario: the one with the most steps in the uncached run.
        if (mode === 'no-cache' && !fresh) fresh = [...rs].sort((a, b) => b.steps.length - a.steps.length)[0]?.name;
        const stats = { calls: llm.stats.calls - before.calls, promptTokens: llm.stats.promptTokens - before.promptTokens, outputTokens: llm.stats.outputTokens - before.outputTokens, ms: llm.stats.ms - before.ms };
        const data = collect(rs, {
          startedAt: new Date(t0),
          driver: driver.name,
          platform: driver.platform,
          model: m.name,
          tags: tags ?? null,
          command: `e2e-ai ${process.argv.slice(2).join(' ')} [${mode}]`,
          llm: stats,
          title: `${context.name} — ${m.name} — ${mode}`,
          noCache: mode === 'no-cache',
        });
        await renderTemplates(cfg, data, dir, [cfg.reports.defaultTemplate], reportModel);
        modeResults.push(modeResult(mode, rs, took, stats.calls, memory, `models/${safeName(m.name)}/${mode}/index.html`, mode === 'one-fresh' ? fresh : undefined));
        console.log(`   ${mode}: ${rs.filter((r) => r.status === 'passed').length}/${rs.length} passed in ${Math.round(took / 1000)} s · memory ${memory.containerPeakGB ?? memory.modelPeakGB ?? '?'} GB`);
        if (mode === 'no-cache' || reports.length === 0) {
          reports = rs;
          suiteStats = stats;
          duration = took;
        }
      }
      const planner: PlannerBenchSummary[] = [];
      for (const c of cases) {
        console.log(`   planner benchmark: ${c.set} (${c.cases.length} labelled steps, docs as written)`);
        planner.push((await benchPlanner({ ctx: context, cases: c.cases, snapshots, llm, examples: true, set: c.set })).summary);
      }
      // Unload this model (Ollama endpoints) so the next model's memory is measured on its own.
      await fetch(`${m.endpoint.replace(/\/v1\/?$/, '')}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) }).catch(() => undefined);
      const result = modelResult(m, info, reports, suiteStats, duration, `models/${safeName(m.name)}/${modes[0]}/index.html`, planner);
      result.modes = modeResults;
      results.push(result);
    }
  } finally {
    await driver.stop();
  }
  const d: BenchmarkData = {
    title: `${context.name} — model benchmark`,
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    target,
    platform: cfg.targets[target]?.platform ?? 'web',
    tags: tags ?? null,
    features: s.featureFiles.map((f) => relative(process.cwd(), f)),
    models: results,
    ...(str('environment') ?? cfg.benchmark?.environment ? { environment: (str('environment') ?? cfg.benchmark?.environment) as string } : {}),
    recommended: recommend(results),
    ai: { sections: {}, model: reportModel?.model ?? null },
  };
  const tdir = join(cfg.reports.templates, 'benchmark');
  const templates = existsSync(tdir) ? readdirSync(tdir).filter((f) => f.endsWith('.html')).sort((a, b) => (a === 'comparison.html' ? -1 : b === 'comparison.html' ? 1 : a.localeCompare(b))) : [];
  mkdirSync(benchDir, { recursive: true });
  writeFileSync(join(benchDir, 'benchmark.json'), `${JSON.stringify(d, null, 2)}\n`);
  const facts = benchmarkFacts(d);
  for (const [i, t] of templates.entries()) {
    const path = join(tdir, t);
    const tpl = readFileSync(path, 'utf8');
    const copy: BenchmarkData = JSON.parse(JSON.stringify(d));
    for (const slot of findSlots(tpl).filter((x) => !x.each)) {
      if (!reportModel) {
        copy.ai.sections[slot.name] = { text: facts.join(' '), accepted: false, reason: 'no pocket model: facts shown' };
        continue;
      }
      const r = await checkedText(reportModel, { task: `${slot.prompt} Base every sentence on the "facts" list.`, brief: templateBrief(tpl), data: { facts }, failed: -1, maxLength: 900 });
      copy.ai.sections[slot.name] = r.ok
        ? { text: r.text, accepted: true, model: reportModel.model }
        : { text: facts.join(' '), accepted: false, reason: `AI text rejected: ${r.reason}`, model: reportModel.model, rejected: r.text };
    }
    const out = join(benchDir, i === 0 ? 'index.html' : t);
    writeFileSync(out, renderBenchmarkHtml(path, copy));
    console.log(`benchmark report: ${relative(process.cwd(), out)}`);
  }
  for (const r of results) {
    console.log(
      `${r.name.padEnd(36)} ${r.suite.error ? `ERROR ${r.suite.error}` : `${r.suite.passed}/${r.suite.scenarios} passed · ${r.suite.msPerPlannedStep} ms/planned step · ${r.planner.map((p) => `${p.set} ${p.exact}%`).join(' · ')}`}`,
    );
  }
  if (d.recommended) console.log(`recommended: ${d.recommended.name} (${d.recommended.why})`);
  return 0;
}

async function report(args: string[]): Promise<number> {
  const { flags, files, str } = parseArgs(args);
  const cfg = loadConfig(str('config'));
  const where = resolve(files[0] ?? '');
  const json = where.endsWith('.json') ? where : join(where, 'report.json');
  if (!existsSync(json)) throw new Error(`no report.json at ${json}`);
  const llm = await reportLlm(cfg, undefined, !!flags['no-ai-report']);
  for (const [i, name] of templateNames(cfg, str('template')).entries()) {
    const out = await rerender({
      jsonPath: json,
      templatePath: join(cfg.reports.templates, `${name}.html`),
      indexName: i === 0 ? 'index.html' : `${name}.html`,
      ...(llm ? { llm } : {}),
    });
    console.log(`report: ${relative(process.cwd(), out)}`);
  }
  return 0;
}

async function doctor(args: string[]): Promise<number> {
  const { str } = parseArgs(args);
  const cfg = loadConfig(str('config'));
  let ok = true;
  const check = (label: string, pass: boolean, detail = '') => {
    console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    ok &&= pass;
  };
  const ctx = appContext(cfg);
  const cat = buildCatalog(ctx);
  check('API docs', ctx.endpoints.length > 0, `${ctx.endpoints.length} endpoints: ${ctx.endpoints.map((e) => e.id).join(', ')}`);
  check('App guide', Object.keys(cat.routes).length > 0, `${Object.keys(cat.routes).length} routes, ${Object.keys(cat.glossary).length} glossary entries, ${cat.examples.length} examples`);
  const lib = loadRoutines(cfg.routines);
  check('Routines', lib.diagnostics.length === 0, `${lib.defs.length} routines${lib.diagnostics.length ? `; ${lib.diagnostics.map((d) => `${d.file}:${d.line} ${d.message}`).join('; ')}` : ''}`);
  const features = walk(cfg.features, '.feature');
  check('Features', features.length > 0, `${features.length} files`);
  const modelOk = await reachable(createLlm(cfg.model));
  check(`Model ${cfg.model.name} @ ${cfg.model.endpoint} (JSON-schema output)`, modelOk, modelOk ? '' : lastModelError);
  for (const name of str('target') ? [str('target') as string] : Object.keys(cfg.targets)) {
    const d = driverFor(cfg, name, ctx);
    try {
      await d.start();
      await d.resetApp();
      const els = await d.snapshot();
      check(`Target ${name} (${d.name})`, els.length > 0, `${els.length} elements on the start screen`);
    } catch (e) {
      check(`Target ${name} (${d.name})`, false, e instanceof Error ? e.message : String(e));
    } finally {
      await d.stop().catch(() => undefined);
    }
  }
  console.log(`templates: ${templateNames(cfg).join(', ')} (in ${relative(process.cwd(), cfg.reports.templates)})`);
  return ok ? 0 : 1;
}

/** `e2e-ai playwright init`: the two tool-owned files that let Playwright Test run the features. */
function playwrightInit(args: string[]): number {
  const { str, flags } = parseArgs(args);
  const cfgPath = str('config') ?? 'e2e/e2e-ai.config.json';
  const dir = resolve(str('dir') ?? 'e2e/playwright');
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    'features.spec.ts': `// Generated by \`e2e-ai playwright init\` — do not edit; write .feature/.routine files instead.
// Playwright runs every scenario; @pn/e2e-ai plans each step (from the docs) and drives this \`page\`.
import { test } from '@playwright/test';
import { defineFeatureTests } from '@pn/e2e-ai/playwright';

defineFeatureTests(test, { config: process.env.E2E_CONFIG ?? ${JSON.stringify(relative(process.cwd(), resolve(cfgPath)))} });
`,
    'global-setup.ts': `// Generated by \`e2e-ai playwright init\`: opens/closes the cloud tunnel of a cloud target (no-op otherwise).
export { default } from '@pn/e2e-ai/playwright-global-setup';
`,
    'playwright.config.ts': `// Generated by \`e2e-ai playwright init\`. Run: npx playwright test -c ${relative(process.cwd(), dir)}
// E2E_REPLAY=1 → reviewed plans only (CI); E2E_TAGS="#smoke" filters; Playwright's --grep @smoke works too.
// A web target with a "cloud" block (E2E_TARGET picks one) runs on Sauce Labs / BrowserStack; without
// one the browsers are local. Credentials: SAUCE_* / BROWSERSTACK_* environment variables.
import { defineConfig } from '@playwright/test';
import { cloudUse } from '@pn/e2e-ai/playwright';

const cloud = cloudUse(process.env.E2E_CONFIG ?? ${JSON.stringify(relative(process.cwd(), resolve(cfgPath)))});

export default defineConfig({
  testDir: '.',
  // Scenarios share one test API (reset before each), so they run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  outputDir: '../reports/runs/playwright/test-results',
  reporter: [['list'], ['html', { outputFolder: '../reports/runs/playwright/html', open: 'never' }]],
  // Opens the cloud tunnel when the target asks for one (tunnel: true); a no-op otherwise.
  globalSetup: './global-setup.ts',
  use: { browserName: 'chromium', viewport: { width: 420, height: 860 }, video: 'on', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...cloud },
});
`,
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    if (existsSync(path) && !flags.force) {
      console.log(`exists: ${relative(process.cwd(), path)} (use --force to overwrite)`);
      continue;
    }
    writeFileSync(path, content);
    console.log(`wrote ${relative(process.cwd(), path)}`);
  }
  console.log(`run: npx playwright test -c ${relative(process.cwd(), dir)}`);
  return 0;
}

const HELP = `e2e-ai — plain-language E2E for web and mobile, planned by a small local model

Commands
  run                      run features (default: every .feature under config.features)
  run --benchmark [models] compare models: '"qwen3-vl:4b"@http://host:11434/v1;"qwen3:4b"@…'
  report <run dir|json>    re-render a run with other templates
  doctor                   check docs, routines, model endpoint (JSON output) and drivers
  init                     set the tool up in any project (asks, or takes flags):
                             --project <dir>        "." (repo root, default) or an app folder, e.g. apps/web
                             --dir <name>           suite folder inside it (default e2e)
                             --integrations a,b     web, web-playwright-test, android-appium, ios-appium,
                                                    android-maestro, ios-maestro, mcp
                             --web-url, --api-url, --app-id, --scheme, --model '"name"@endpoint'
                             --ci github            also write .github/workflows/e2e.yml
                             --cloud saucelabs,browserstack  also write each target's cloud variant
                             --yes                  no questions (defaults: web only)   --force  overwrite
  playwright init          let Playwright Test run the features (engine drives Playwright's page)

Run options
  --config <file>          default e2e/e2e-ai.config.json
  --target <name>          a target in the config: web, web-playwright-mcp, ios, android, ios-appium, …
  --model '"name"@url'     override the planning model (endpoint optional)
  --replay                 CI: only reviewed plans, no model; a missing plan fails the step
  --no-cache               plan every step every time; never read/write the plans file
  --tags "#a,!#b"          any of #a, none of #b
  --shard i/n              run the i-th of n slices (parallel CI jobs)
  --max-failures N         stop after N failed scenarios
  --junit <file>           JUnit XML for CI dashboards
  --template a,b           report templates (default: all; first → index.html)
  --no-ai-report           report layout/texts generated without the model
  --screenshots steps|failures|none   --video all|mobile|none
  [feature files…]

Benchmark options
  --modes no-cache,cache,one-fresh   --fresh-scenario "<name>"   --memory-docker <container>[@context]
  --environment "<machine description>"

Exit codes: 0 all passed · 1 a scenario failed · 2 configuration/usage error`;

/** `e2e-ai init`: the files a team owns, with working defaults and comments on what to fill in. */
async function init(args: string[]): Promise<number> {
  const { str, flags } = parseArgs(args);
  const root = process.cwd();
  const interactive = process.stdin.isTTY && !flags.yes && !str('integrations');
  const ask = interactive ? await prompter() : undefined;
  const q = async (question: string, fallback: string) => (ask ? (await ask(`${question} [${fallback}]: `)).trim() || fallback : fallback);
  const project = str('project') ?? (await q('Set up in which project folder ("." = repo root, or e.g. apps/web)', '.'));
  const dir = str('dir') ?? (await q('Suite folder inside it', 'e2e'));
  let integrationList = str('integrations');
  if (!integrationList && ask) {
    const names = Object.keys(INTEGRATIONS) as Integration[];
    console.log('\nIntegrations (how the tool drives the app):');
    names.forEach((n, k) => console.log(`  ${k + 1}. ${n.padEnd(20)} ${INTEGRATIONS[n].label}`));
    const picked = await q('Pick numbers or names, comma-separated', '1');
    integrationList = picked
      .split(',')
      .map((x) => x.trim())
      .map((x) => (/^\d+$/.test(x) ? (names[Number(x) - 1] ?? x) : x))
      .join(',');
  }
  const integrations = parseIntegrations(integrationList ?? 'web');
  const hasWeb = integrations.some((i) => INTEGRATIONS[i].platform === 'web');
  const hasMobile = integrations.some((i) => INTEGRATIONS[i].platform === 'mobile');
  const spec = str('model') ? parseModelSpecs(str('model') as string, { provider: 'openai', endpoint: DEFAULTS.model.endpoint, name: DEFAULTS.model.name })[0] : undefined;
  const o: InitOptions = {
    project,
    dir,
    integrations,
    webUrl: str('web-url') ?? (hasWeb ? await q('Web app URL', DEFAULTS.webUrl) : DEFAULTS.webUrl),
    apiUrl: str('api-url') ?? (await q('Test-data API base URL', DEFAULTS.apiUrl)),
    appId: str('app-id') ?? (hasMobile ? await q('Mobile app id (bundle id / package)', DEFAULTS.appId) : DEFAULTS.appId),
    scheme: str('scheme') ?? (hasMobile ? await q('Mobile URL scheme (deep links)', DEFAULTS.scheme) : DEFAULTS.scheme),
    model: spec ? { name: spec.name, endpoint: spec.endpoint ?? DEFAULTS.model.endpoint } : DEFAULTS.model,
    ...(str('ci') === 'github' || flags.ci ? { ci: 'github' as const } : {}),
    ...(str('cloud') ? { clouds: parseClouds(str('cloud') as string) } : {}),
  };
  ask?.close();
  const plan = planInit(o);
  console.log(`\nSetting up e2e-ai in ${relative(root, resolve(root, project)) || '.'}/${dir} (${integrations.join(', ')})`);
  applyInit(root, o, plan, !!flags.force);
  // Report templates bundled with the engine.
  const pkgTemplates = join(dirname(new URL(import.meta.url).pathname), '../../e2e-ai/templates');
  const tdir = join(root, project, dir, 'reports/templates');
  for (const f of walk(pkgTemplates, '.html')) {
    const out = join(tdir, relative(pkgTemplates, f));
    if (existsSync(out) && !flags.force) continue;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, readFileSync(f));
    console.log(`wrote  ${relative(root, out)}`);
  }
  if (integrations.includes('web-playwright-test')) {
    playwrightInit(['--config', join(project, dir, 'e2e-ai.config.json'), '--dir', join(project, dir, 'playwright'), ...(flags.force ? ['--force'] : [])]);
  }
  const suite = join(relative(root, resolve(root, project)) || '.', dir);
  console.log(`
next:
  1. describe your API and screens: ${join(suite, 'docs')}/ (exact visible texts)
  2. start the app and its test API, and the model (e.g. \`ollama pull ${o.model.name}\`)
  3. ${project === '.' ? '' : `cd ${project} && `}npm run e2e:doctor   then   npm run e2e -- --target ${Object.keys((JSON.parse([...plan.files.values()][0] ?? '{}') as { targets?: object }).targets ?? {})[0] ?? 'web'}
  guide: ${join(suite, 'README.md')}`);
  return 0;
}

function parseClouds(list: string): ('saucelabs' | 'browserstack')[] {
  const all = list === 'both' ? ['saucelabs', 'browserstack'] : list.split(',').map((x) => x.trim());
  for (const c of all) if (c !== 'saucelabs' && c !== 'browserstack') throw new Error(`--cloud: "${c}" is not saucelabs or browserstack`);
  return all as ('saucelabs' | 'browserstack')[];
}

/** Line prompts on the terminal (only when stdin is a TTY). */
async function prompter(): Promise<((q: string) => Promise<string>) & { close(): void }> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const fn = ((q: string) => rl.question(q)) as ((q: string) => Promise<string>) & { close(): void };
  fn.close = () => rl.close();
  return fn;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help' || rest.includes('--help')) {
    console.log(HELP);
    return cmd ? 0 : 2;
  }
  if (cmd === 'init') return init(rest);
  if (cmd === 'playwright' && rest[0] === 'init') return playwrightInit(rest.slice(1));
  if (cmd === 'run') return run(rest);
  if (cmd === 'report') return report(rest);
  if (cmd === 'doctor') return doctor(rest);
  console.error(`unknown command "${cmd}"\n\n${HELP}`);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(2);
  },
);
