// Runs scenarios: plan each step (cache first, LLM on a miss), execute its actions on a driver,
// poll assertions, heal stale targets, and report per step where the plan came from.
import { planKey, type PlanCache } from './cache.ts';
import { lookupFact } from './docs.ts';
import { buildCatalog, catalogFingerprint, type Catalog } from './catalog.ts';
import { join } from 'node:path';

import { routineCall, type Scenario, type ScenarioStep } from './gherkin.ts';
import type { GlobalRule } from './globalSyntax.ts';
import { GLOBAL_PLANNER_VERSION, planGlobal } from './globals.ts';
import { ground, groundGroup, toResolved, type Intent } from './grounder.ts';
import type { Llm } from './llm.ts';
import { planStep } from './planner.ts';
import { expandCall, type Origin, type RoutineLibrary } from './routines.ts';
import {
  createWorld,
  type AppContext,
  type Driver,
  type PlannedAction,
  type StepPlan,
  type UiElement,
  type World,
} from './types.ts';

export interface StepReport {
  step: string;
  keyword: ScenarioStep['keyword'];
  /** From a `Background:` block: reported as BACKGROUND, not Given/When/Then. */
  background?: boolean;
  line?: number;
  /** Routine call chain this step came from (outermost first). */
  origin?: Origin[];
  screenshot?: string;
  /** Seconds from the start of the scenario video when the step began / ended (step clips). */
  at?: number;
  atEnd?: number;
  status: 'passed' | 'failed' | 'skipped';
  source: 'cache' | 'llm' | 'none';
  actions: PlannedAction[];
  guardFixes: string[];
  healed: string[];
  ms: number;
  planMs: number;
  error?: string;
  /** `@global` rules that fired while this step ran (their trigger was on screen). */
  globals?: GlobalFire[];
}

export interface GlobalFire {
  rule: string;
  /** Where the rule is written, `file:line`. */
  at: string;
  actions: PlannedAction[];
  error?: string;
}

export interface ScenarioReport {
  feature: string;
  file: string;
  line?: number;
  name: string;
  tags: string[];
  rule?: string;
  status: 'passed' | 'failed';
  steps: StepReport[];
  ms: number;
  /** Screenshot of the final screen (relative to the report directory). */
  screenshot?: string;
  /** Screen recording of the whole scenario (relative to the report directory). */
  video?: string;
}

export interface RunOptions {
  context: AppContext;
  driver: Driver;
  llm?: Llm; // absent → cache-only (CI replay mode)
  cache: PlanCache;
  timeoutMs?: number; // per action polling budget
  log?: (line: string) => void;
  /** This scenario ignores cached plans (plans every step; the new plans are still stored). */
  bypassCache?: boolean;
  /** Wraps each step's execution (e.g. Playwright's test.step); a thrown error marks it failed there. */
  wrapStep?: (title: string, run: () => Promise<void>, report: StepReport) => Promise<void>;
  /** `.routine` definitions for `@routine` calls. */
  routines?: RoutineLibrary;
  /** `@global` rules: checked on every screen read; when a rule's trigger is visible, it acts. */
  globals?: GlobalRule[];
  /**
   * Media: screenshots after every step ('steps'), only on failure ('failures') or none; a video per
   * scenario when `video` is on and the driver can record. `dir` is absolute, `rel` is how the
   * report refers to it.
   */
  screenshots?: { dir: string; rel: string; mode: 'steps' | 'failures' | 'none'; video?: boolean; stepPauseMs?: number };
}

const scopeKey = (scope?: Record<string, string>) =>
  scope ? JSON.stringify(Object.fromEntries(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)))) : '';
const keyOf = (step: ScenarioStep, fingerprint: string) => planKey(step.text, step.keyword, fingerprint + scopeKey(step.scope));
/** The plan-cache key of a step (what the runner stores and replays). */
export const stepPlanKey = keyOf;
/** The plan-cache key of an @global rule (its triggers depend on the screens description too). */
export const globalPlanKey = (rule: string, fingerprint: string, description: string) =>
  planKey(rule, 'global', `${fingerprint}\n${description}\nglobal-planner:${GLOBAL_PLANNER_VERSION}`);

/** Replaces each `@routine` call with the steps it expands to; a failed expansion becomes an error step. */
export async function expandRoutines(steps: ScenarioStep[], opts: Pick<RunOptions, 'routines' | 'llm'>): Promise<ScenarioStep[]> {
  const out: ScenarioStep[] = [];
  for (const step of steps) {
    const call = routineCall(step);
    if (call === undefined) {
      out.push(step);
      continue;
    }
    const keyword = step.keyword === 'unknown' ? 'context' : step.keyword;
    try {
      if (!opts.routines) throw new Error('no routines loaded (--routines <dir>)');
      const expanded = await expandCall(call, step.table, keyword, { lib: opts.routines, ...(opts.llm ? { llm: opts.llm } : {}) });
      for (const e of expanded) {
        const s: ScenarioStep = { keyword: e.keyword, text: e.text, origin: e.origin, scope: e.scope };
        if (e.table) s.table = e.table;
        if (step.line !== undefined) s.line = step.line;
        if (step.background) s.background = true;
        out.push(s);
      }
    } catch (e) {
      const s: ScenarioStep = { ...step, error: e instanceof Error ? e.message : String(e) };
      out.push(s);
    }
  }
  return out;
}

async function shoot(opts: RunOptions, name: string): Promise<string | undefined> {
  if (!opts.screenshots || opts.screenshots.mode === 'none' || !opts.driver.screenshot) return undefined;
  try {
    await opts.driver.screenshot(join(opts.screenshots.dir, name));
    return `${opts.screenshots.rel}/${name}`;
  } catch {
    return undefined; // a screenshot never fails a test
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function poll<T>(timeoutMs: number, fn: () => Promise<T | undefined>): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined || Date.now() > end) return v;
    await sleep(250);
  }
}

function hasText(elements: UiElement[], value: string): boolean {
  const v = value.toLowerCase();
  return elements.some(
    (e) =>
      // Only rendered text counts: a value typed into an input is not "seeing" it (false-pass guard).
      e.role !== 'textbox' && (e.name.toLowerCase().includes(v) || e.text.toLowerCase().includes(v)),
  );
}

class StepFailure extends Error {}

interface ExecCtx {
  driver: Driver;
  world: World;
  catalog: Catalog;
  llm: Llm | undefined;
  plan: StepPlan;
  healed: string[];
  timeoutMs: number;
}

async function resolveTarget(x: ExecCtx, a: PlannedAction, intent: Intent): Promise<UiElement> {
  const desc = a.target || a.value || '';
  // Value-bearing taps ("tap note 'Milk'") include the value so scoring sees the quoted text.
  const query = a.value && a.target && !a.target.includes(a.value) ? `${a.target} "${a.value}"` : desc;
  const key = `${x.driver.platform}:${query}`;
  const resolved = x.plan.resolved[key];
  const found = await poll(x.timeoutMs, async () => {
    const els = await x.driver.snapshot();
    const r = await ground(els, query, intent, { ...(x.llm ? { llm: x.llm } : {}), ...(resolved ? { resolved } : {}) });
    return r.element ? { el: r.element, via: r.via } : undefined;
  });
  if (!found) throw new StepFailure(`no element for ${intent} "${query}"`);
  const now = toResolved(found.el);
  if (found.via !== 'resolved') {
    if (resolved) x.healed.push(`${query}: ${JSON.stringify(resolved)} -> ${JSON.stringify(now)}`);
    x.plan.resolved[key] = now;
  }
  return found.el;
}

/** Ground then act; a ref that went stale (the UI re-rendered in between) is re-grounded and retried. */
async function act(x: ExecCtx, a: PlannedAction, intent: Intent, run: (ref: string) => Promise<void>): Promise<void> {
  const end = Date.now() + x.timeoutMs;
  for (;;) {
    const el = await resolveTarget(x, a, intent);
    try {
      await run(el.ref);
      return;
    } catch (e) {
      if (e instanceof StepFailure || Date.now() > end) throw e;
      await sleep(200);
    }
  }
}

/** Runs one `call` action (an API endpoint from the docs) and remembers its answer as facts. */
export async function runCall(catalog: Catalog, world: World, driver: Driver, a: PlannedAction): Promise<void> {
  const fn = catalog.fns[a.fn ?? ''];
  if (!fn) throw new StepFailure(`unknown fn ${a.fn}`);
  const result = await fn.run(a.args ?? {}, { driver, world });
  if (result !== undefined) world.remember(`${a.fn}#${Object.keys(world.facts).length}`, result);
}

async function execute(x: ExecCtx, a: PlannedAction): Promise<void> {
  switch (a.kind) {
    case 'call':
      return runCall(x.catalog, x.world, x.driver, a);
    case 'open': {
      if (!a.route) throw new StepFailure('open without route');
      // Route templates ({token}) are filled from what the scenario's API calls returned.
      const spec = x.catalog.routes[a.route];
      const template = `${spec?.web ?? ''} ${spec?.mobile ?? ''}`;
      const params: Record<string, string> = {};
      for (const m of template.matchAll(/\{(\w+)\}/g)) {
        const v = lookupFact(x.world.facts, m[1] as string);
        if (v === undefined) throw new StepFailure(`route ${a.route} needs {${m[1]}}, which no earlier API call returned`);
        params[m[1] as string] = v;
      }
      await x.driver.openRoute(a.route, params);
      return;
    }
    case 'tap':
      return act(x, a, 'tap', (ref) => x.driver.tap(ref));
    case 'fill':
      return act(x, { ...a, value: '' }, 'fill', (ref) => x.driver.fill(ref, a.value ?? ''));
    case 'expect_visible':
    case 'expect_hidden': {
      const want = a.kind === 'expect_visible';
      if (a.value) {
        const ok = await poll(x.timeoutMs, async () => (hasText(await x.driver.snapshot(), a.value as string) === want ? true : undefined));
        if (!ok) throw new StepFailure(`expected "${a.value}" to be ${want ? 'visible' : 'hidden'}`);
        return;
      }
      if (!want) throw new StepFailure('expect_hidden needs a value');
      await resolveTarget(x, a, 'read');
      return;
    }
    case 'expect_count': {
      let last = -1;
      let group: { key: string; items: UiElement[] } | undefined;
      const ok = await poll(x.timeoutMs, async () => {
        group = groundGroup(await x.driver.snapshot(), a.target ?? '');
        last = group?.items.length ?? 0;
        return last === a.count ? true : undefined;
      });
      if (!ok) throw new StepFailure(`expected ${a.count} × "${a.target}", found ${last}`);
      // Remember which group was counted (flows compiled for clouds count the same elements).
      if (group) x.plan.resolved[`${x.driver.platform}:${a.target ?? ''}#group`] = { role: group.items[0]?.role ?? 'listitem', name: '', pattern: group.key };
      return;
    }
  }
}

async function getPlan(
  step: ScenarioStep,
  world: World,
  catalog: Catalog,
  fingerprint: string,
  opts: RunOptions,
  feedback?: string,
): Promise<{ plan: StepPlan; source: 'cache' | 'llm'; guardFixes: string[]; planMs: number }> {
  const key = keyOf(step, fingerprint);
  const cached = feedback || opts.bypassCache ? undefined : opts.cache.get(key);
  if (cached) return { plan: cached, source: 'cache', guardFixes: [], planMs: 0 };
  if (!opts.llm) throw new StepFailure('no cached plan and no model (cache-only mode)');
  const t0 = performance.now();
  const r = await planStep(opts.llm, catalog, {
    step: step.text,
    keyword: step.keyword,
    facts: step.scope ? { ...world.facts, routine: step.scope } : world.facts,
    ...(step.table ? { table: step.table } : {}),
    ...(feedback ? { feedback } : {}),
  });
  const plan: StepPlan = {
    step: step.text,
    actions: r.actions,
    resolved: {},
    model: opts.llm.model,
    createdAt: new Date().toISOString(),
  };
  if (plan.actions.length === 0) throw new StepFailure(`planner produced no usable action (${r.guardFixes.join('; ')})`);
  opts.cache.set(key, plan);
  return { plan, source: 'llm', guardFixes: r.guardFixes, planMs: performance.now() - t0 };
}

// ---------------------------------------------------------------- @global rules

interface ActiveGlobal {
  rule: GlobalRule;
  key: string;
  plan: StepPlan;
  fired: number;
}

/** A rule fires at most this often per scenario: a sheet that will not close must not loop forever. */
const MAX_GLOBAL_FIRES = 5;
/** Plans made once per run even when the cache is off (--no-cache), keyed by the run's cache. */
const globalMemo = new WeakMap<PlanCache, Map<string, StepPlan>>();

async function prepareGlobals(
  opts: RunOptions,
  catalog: Catalog,
  fingerprint: string,
  log: (l: string) => void,
): Promise<{ active: ActiveGlobal[]; errors: string[] }> {
  const active: ActiveGlobal[] = [];
  const errors: string[] = [];
  const memo = globalMemo.get(opts.cache) ?? new Map<string, StepPlan>();
  globalMemo.set(opts.cache, memo);
  // The trigger texts are grounded in the screens description, so it is part of the key.
  for (const rule of opts.globals ?? []) {
    const key = globalPlanKey(rule.text, fingerprint, opts.context.description);
    let plan = memo.get(key) ?? opts.cache.get(key);
    if (!plan) {
      if (!opts.llm) {
        errors.push(`@global "${rule.text}" (${rule.file}:${rule.line}) has no reviewed plan; run without --replay to plan it`);
        continue;
      }
      const t0 = performance.now();
      try {
        const r = await planGlobal(opts.llm, catalog, opts.context.description, rule);
        plan = { step: rule.text, when: r.when, actions: r.actions, resolved: {}, model: opts.llm.model, createdAt: new Date().toISOString() };
        opts.cache.set(key, plan);
        log(
          `  @global ${rule.text}  [llm ${Math.round(performance.now() - t0)}ms] when ${r.when.map((w) => `"${w}"`).join(' + ')} → ${r.actions
            .map((a) => `${a.kind}(${a.target ?? ''})${a.value ? `="${a.value}"` : ''}`)
            .join(' → ')}${r.guardFixes.length ? `\n    guard: ${r.guardFixes.join('; ')}` : ''}`,
        );
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        continue;
      }
    }
    memo.set(key, plan);
    active.push({ rule, key, plan, fired: 0 });
  }
  return { active, errors };
}

/**
 * The driver every step uses: each screen read first checks the @global triggers (every trigger
 * text visible) and lets a matching rule act, then reads again. The rule's own actions run on the
 * raw driver, so a rule never re-triggers itself mid-action.
 */
function watchGlobals(
  driver: Driver,
  active: ActiveGlobal[],
  ctx: Omit<ExecCtx, 'driver' | 'plan' | 'healed'>,
  cache: PlanCache,
  onFire: (f: GlobalFire) => void,
): Driver {
  if (active.length === 0) return driver;
  let busy = false;
  const snapshot = async (): Promise<UiElement[]> => {
    let els = await driver.snapshot();
    if (busy) return els;
    for (;;) {
      const hit = active.find((g) => g.fired < MAX_GLOBAL_FIRES && (g.plan.when ?? []).length > 0 && (g.plan.when ?? []).every((t) => hasText(els, t)));
      if (!hit) return els;
      hit.fired++;
      const fire: GlobalFire = { rule: hit.rule.text, at: `${hit.rule.file}:${hit.rule.line}`, actions: hit.plan.actions };
      busy = true;
      try {
        const x: ExecCtx = { ...ctx, driver, plan: hit.plan, healed: [] };
        for (const a of hit.plan.actions) await execute(x, a);
        cache.set(hit.key, hit.plan); // keep what its targets resolved to
      } catch (e) {
        fire.error = e instanceof Error ? e.message : String(e);
      } finally {
        busy = false;
      }
      onFire(fire);
      if (fire.error) return els;
      await sleep(300);
      els = await driver.snapshot();
    }
  };
  return new Proxy(driver, {
    get(target, prop) {
      if (prop === 'snapshot') return snapshot;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

let shotSeq = 0;

export async function runScenario(scenario: Scenario, opts: RunOptions): Promise<ScenarioReport> {
  const log = opts.log ?? (() => undefined);
  const catalog = buildCatalog(opts.context);
  const fingerprint = catalogFingerprint(catalog);
  const world = createWorld();
  const t0 = performance.now();
  const globals = await prepareGlobals(opts, catalog, fingerprint, log);
  let currentReport: StepReport | undefined;
  const driver = watchGlobals(opts.driver, globals.active, { world, catalog, llm: opts.llm, timeoutMs: opts.timeoutMs ?? 5000 }, opts.cache, (f) => {
    if (currentReport) (currentReport.globals ??= []).push(f);
    log(`    ↺ @global ${f.rule} → ${f.actions.map((a) => `${a.kind}(${a.target ?? ''})`).join(' → ')}${f.error ? `  ! ${f.error}` : ''}`);
  });
  await opts.context.beforeScenario?.({ driver: opts.driver, world });
  await opts.driver.resetApp();
  log(`\n  Scenario: ${scenario.name}`);
  const steps: StepReport[] = [];
  let failed = false;
  const shotBase = `${String(++shotSeq).padStart(3, '0')}-${scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  // Video: started after the reset, so it shows exactly this scenario.
  let videoStart: number | undefined;
  if (opts.screenshots?.video && opts.driver.startRecording) {
    try {
      await opts.driver.startRecording(join(opts.screenshots.dir, '..', 'videos', shotBase));
      videoStart = performance.now();
    } catch (e) {
      log(`    (no video: ${e instanceof Error ? e.message : String(e)})`);
    }
  }
  let stepNo = 0;
  const expanded = await expandRoutines(scenario.steps, opts);
  // A rule that could not be planned fails the scenario up front, never silently stops applying.
  if (globals.errors.length && expanded[0]) expanded[0] = { ...expanded[0], error: expanded[0].error ?? globals.errors.join('; ') };
  for (const step of expanded) {
    const base: StepReport = {
      step: step.text,
      keyword: step.keyword,
      status: 'passed',
      source: 'none',
      actions: [],
      guardFixes: [],
      healed: [],
      ms: 0,
      planMs: 0,
    };
    if (step.line !== undefined) base.line = step.line;
    if (step.origin) base.origin = step.origin;
    if (step.background) base.background = true;
    if (failed) {
      steps.push({ ...base, status: 'skipped' });
      log(`    - ${step.text}`);
      continue;
    }
    const report: StepReport = base;
    currentReport = report;
    const runOne = async (): Promise<void> => {
      const s0 = performance.now();
      stepNo++;
      if (videoStart !== undefined) report.at = Math.max(0, (s0 - videoStart) / 1000);
      try {
        if (step.error) throw new StepFailure(step.error);
        const { plan, source, guardFixes, planMs } = await getPlan(step, world, catalog, fingerprint, opts);
        Object.assign(report, { source, actions: plan.actions, guardFixes, planMs });
        const x: ExecCtx = {
          driver,
          world,
          catalog,
          llm: opts.llm,
          plan,
          healed: report.healed,
          timeoutMs: opts.timeoutMs ?? 5000,
        };
        try {
          for (const a of plan.actions) await execute(x, a);
        } catch (e) {
          // Plan-repair loop: a plan the model just made, with no data side effects, gets ONE retry with
          // the failure as feedback. Cached plans and plans with `call` never retry (no duplicate data).
          // NEVER for assertions: a model asked to "fix" a failing expectation rewrites the expectation
          // (seen: "I should see 1 note" re-planned as "expect 0") — a false-pass factory.
          const repairable =
            e instanceof StepFailure &&
            source === 'llm' &&
            step.keyword !== 'outcome' &&
            plan.actions.every((a) => a.kind === 'tap' || a.kind === 'fill' || a.kind === 'open');
          if (!repairable) throw e;
          const shown = plan.actions.map((a) => `${a.kind}(${a.target ?? ''}${a.value ? `="${a.value}"` : ''})`).join(', ');
          const retry = await getPlan(step, world, catalog, fingerprint, opts, `[${shown}] -> ${e.message}`);
          report.guardFixes.push(`re-planned after: ${e.message}`);
          Object.assign(report, { actions: retry.plan.actions, planMs: report.planMs + retry.planMs });
          x.plan = retry.plan;
          for (const a of retry.plan.actions) await execute(x, a);
          Object.assign(plan, retry.plan);
        }
        opts.cache.set(keyOf(step, fingerprint), plan); // persist resolutions/heals
      } catch (e) {
        failed = true;
        report.status = 'failed';
        report.error = e instanceof Error ? e.message : String(e);
      }
      report.ms = performance.now() - s0;
      // While recording, let the screen settle so each step's slice of the video is watchable.
      if (videoStart !== undefined && opts.screenshots?.stepPauseMs) await sleep(opts.screenshots.stepPauseMs);
      if (videoStart !== undefined && report.at !== undefined) report.atEnd = (performance.now() - videoStart) / 1000;
      // The screen after the step (every step in 'steps' mode; the failing one in 'failures' mode).
      if (opts.screenshots?.mode === 'steps' || (failed && opts.screenshots?.mode === 'failures')) {
        const shot = await shoot(opts, `${shotBase}-${String(stepNo).padStart(2, '0')}${report.status === 'failed' ? '-failed' : ''}.png`);
        if (shot) report.screenshot = shot;
      }
    };
    // Integrations (Playwright Test) wrap each step so their own reports show it as a step.
    if (opts.wrapStep) {
      const title = `${step.background ? 'Background' : ({ context: 'Given', action: 'When', outcome: 'Then', unknown: 'Step' } as const)[step.keyword]} ${step.text}`;
      await opts
        .wrapStep(title, async () => {
          await runOne();
          if (report.status === 'failed') throw new Error(report.error ?? 'step failed');
        }, report)
        .catch(() => undefined);
    } else await runOne();
    steps.push(report);
    const mark = report.status === 'passed' ? '✓' : '✗';
    const via = step.origin?.length ? `  ⟵ ${step.origin.map((o) => o.file.split('/').pop()).join(' › ')}` : '';
    log(
      `    ${mark} ${step.text}${via}  [${report.source}${report.planMs ? ` ${Math.round(report.planMs)}ms` : ''}] ${report.actions
        .map((a) => a.kind + (a.fn ? `:${a.fn}` : '') + (a.target ? `(${a.target})` : '') + (a.value ? `="${a.value}"` : ''))
        .join(' → ')}${report.error ? `\n      ! ${report.error}` : ''}${report.guardFixes.length ? `\n      guard: ${report.guardFixes.join('; ')}` : ''}`,
    );
  }
  opts.cache.save();
  const result: ScenarioReport = {
    feature: scenario.feature,
    file: scenario.uri,
    name: scenario.name,
    tags: scenario.tags,
    status: failed ? 'failed' : 'passed',
    steps,
    ms: performance.now() - t0,
  };
  if (scenario.line !== undefined) result.line = scenario.line;
  if (scenario.rule) result.rule = scenario.rule;
  // The scenario's picture: the failing step's screen, else the last screen.
  const shot = (steps.find((st) => st.status === 'failed') ?? [...steps].reverse().find((st) => st.screenshot))?.screenshot;
  if (shot) result.screenshot = shot;
  if (videoStart !== undefined && opts.driver.stopRecording) {
    try {
      const file = await opts.driver.stopRecording();
      if (file && opts.screenshots) result.video = `videos/${file.split('/').pop()}`;
    } catch (e) {
      log(`    (video not saved: ${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return result;
}
