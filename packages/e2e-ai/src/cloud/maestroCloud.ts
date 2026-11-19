// Maestro on device clouds. A cloud starts a fresh remote session per Maestro flow, so the engine
// cannot drive Maestro one action at a time there (that is how the local maestro driver works).
// Instead each scenario becomes ONE flow compiled from its reviewed plans (replay: no model):
//   - the scenario's API setup (`call` actions) runs here first, so its answers (tokens, ids) fill
//     the deep links, exactly as the runner does;
//   - UI actions become Maestro commands on the elements recorded by an earlier mobile run
//     (`plans.json` → resolved targets), stable test ids first, accessible names otherwise;
//   - assertions become assertVisible / assertNotVisible;
//   - @global rules become a conditional runFlow before every UI step.
// Then the flow runs on the cloud: maestro-runner against the vendor's Appium hub (Sauce Labs,
// BrowserStack), or BrowserStack's own Maestro API.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { PlanCache } from '../cache.ts';
import { buildCatalog, catalogFingerprint, type Catalog } from '../catalog.ts';
import { lookupFact } from '../docs.ts';
import { fillTemplate } from '../mcp/mcpDriver.ts';
import type { GlobalRule } from '../globalSyntax.ts';
import type { Scenario, ScenarioStep } from '../gherkin.ts';
import type { RoutineLibrary } from '../routines.ts';
import { expandRoutines, globalPlanKey, runCall, stepPlanKey, type ScenarioReport, type StepReport } from '../runner.ts';
import { createWorld, type AppContext, type Driver, type PlannedAction, type ResolvedTarget, type StepPlan } from '../types.ts';
import { apiBase, basicAuth, cloudAppiumCapabilities, credentials, appiumHub, redact, uploadApp, type CloudConfig } from './cloud.ts';

const run = promisify(execFile);

export interface MaestroCloudTarget {
  os: 'ios' | 'android';
  appId: string;
  scheme: string;
  resetLink?: string;
  capabilities: Record<string, unknown>;
}

// ---------------------------------------------------------------- compile

const q = (s: string) => JSON.stringify(s); // JSON strings are YAML scalars
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Case-insensitive "contains" (Maestro matches text and accessibility text with a full-match regex). */
const containsText = (s: string) => `(?i).*${reEscape(s.trim())}.*`;
/** Ids that carry data (note-delete-n2) differ between runs: match those by accessible name instead. */
const dataDependent = (id: string) => /\d/.test(id);

export function selector(r: ResolvedTarget): string[] {
  if (r.testId && !dataDependent(r.testId)) return [`id: ${q(r.testId)}`];
  if (r.name) return [`text: ${q(`(?i)${reEscape(r.name.trim())}`)}`];
  if (r.testId) return [`id: ${q(r.testId.replace(/\d+/g, '[0-9]+'))}`];
  throw new Error('no selector');
}

const block = (cmd: string, lines: string[], label: string) => [`- ${cmd}:`, ...lines.map((l) => `    ${l}`), `    label: ${q(label)}`];

export class CompileError extends Error {
  /** Index of the step that cannot be expressed (set by compileScenario). */
  step?: number;
}

export interface CompiledScenario {
  /** Flow YAML; empty when the scenario has no UI step. */
  yaml: string;
  /** Step index → command label prefix, to map a failing command back to its step. */
  labels: string[];
}

/** One scenario → one Maestro flow. `facts` must hold the answers of the scenario's API calls. */
export function compileScenario(
  steps: { step: ScenarioStep; plan: StepPlan }[],
  t: MaestroCloudTarget,
  routes: Catalog['routes'],
  facts: Record<string, unknown>,
  globals: StepPlan[],
): CompiledScenario {
  const out: string[] = [`appId: ${t.appId}`, '---', '- launchApp', ...(t.resetLink ? [`- openLink: ${q(`${t.scheme}://${t.resetLink}`)}`] : [])];
  const labels: string[] = [];
  const guard = globals.flatMap((g, gi) => {
    const when = g.when ?? [];
    if (!when.length) return [];
    const cmds = g.actions.flatMap((a) => uiCommands(a, g, `global ${gi + 1}`, 'mobile'));
    return [
      '- runFlow:',
      '    when:',
      `      visible: ${q(containsText(when[0] as string))}`,
      '    commands:',
      ...cmds.map((l) => `      ${l}`),
    ];
  });
  let ui = false;
  steps.forEach(({ step, plan }, i) => {
    const label = `step ${i + 1}`;
    labels.push(label);
    try {
      compileStep(step, plan, label);
    } catch (e) {
      if (e instanceof CompileError && e.step === undefined) e.step = i;
      throw e;
    }
  });
  function compileStep(step: ScenarioStep, plan: StepPlan, label: string): void {
    for (const a of plan.actions) {
      if (a.kind === 'call') {
        if (ui) throw new CompileError(`"${step.text}" calls the API after UI steps; a cloud Maestro flow runs as a whole — use an Appium target for this scenario`);
        continue; // already executed by the engine
      }
      ui = true;
      if (a.kind !== 'open') out.push(...guard);
      if (a.kind === 'open') {
        const spec = routes[a.route ?? ''];
        if (!spec?.mobile) throw new CompileError(`route ${a.route} has no mobile deep link in the app guide`);
        const params: Record<string, string> = {};
        for (const m of spec.mobile.matchAll(/\{(\w+)\}/g)) {
          const v = lookupFact(facts, m[1] as string);
          if (v === undefined) throw new CompileError(`route ${a.route} needs {${m[1]}}, which no earlier API call returned`);
          params[m[1] as string] = v;
        }
        out.push(...block('openLink', [`link: ${q(`${t.scheme}://${fillTemplate(spec.mobile, params)}`)}`], `${label}: ${step.text}`));
        continue;
      }
      out.push(...uiCommands(a, plan, `${label}: ${step.text}`, 'mobile'));
    }
  }
  return { yaml: ui ? `${out.join('\n')}\n` : '', labels };
}

function uiCommands(a: PlannedAction, plan: StepPlan, label: string, platform: string): string[] {
  const resolvedFor = () => {
    const query = a.value && a.target && !a.target.includes(a.value) ? `${a.target} "${a.value}"` : a.target || a.value || '';
    const r = plan.resolved[`${platform}:${query}`] ?? (a.kind === 'fill' ? plan.resolved[`${platform}:${a.target ?? ''}`] : undefined);
    if (!r) {
      throw new CompileError(
        label.startsWith('global')
          ? `@global "${plan.step}" has not fired on a ${platform} run yet, so its "${query}" was never recorded — run a mobile target where its screen shows (e.g. on a fresh install)`
          : `"${plan.step}": no recorded ${platform} element for "${query}" — run this suite once on a mobile target (e.g. android-appium) to record it`,
      );
    }
    return r;
  };
  switch (a.kind) {
    case 'tap':
      return block('tapOn', selector(resolvedFor()), label);
    case 'fill':
      return [...block('tapOn', selector(resolvedFor()), label), `- eraseText: 60`, ...block('inputText', [`text: ${q(a.value ?? '')}`], label)];
    case 'expect_visible':
      if (a.value) return block('assertVisible', [`text: ${q(containsText(a.value))}`], label);
      return block('assertVisible', selector(resolvedFor()), label);
    case 'expect_hidden':
      if (!a.value) throw new CompileError(`"${plan.step}": expect_hidden needs a value`);
      return block('assertNotVisible', [`text: ${q(containsText(a.value))}`], label);
    case 'expect_count': {
      // Maestro has no count assertion; with indexed matches it does: the N-th exists, the N+1-th not.
      const g = plan.resolved[`${platform}:${a.target ?? ''}#group`];
      if (!g?.pattern) throw new CompileError(`"${plan.step}": no recorded ${platform} group for "${a.target}" — run this suite once on a mobile target (e.g. android-appium) to record it`);
      if (g.pattern.startsWith('role:')) throw new CompileError(`"${plan.step}": the counted items have no test ids; Maestro cannot select by role — add testIDs to the rows or use an Appium target`);
      const id = `${reEscape(g.pattern.replace(/-?\*$/, ''))}.+`;
      const n = a.count ?? 0;
      if (n === 0) return block('assertNotVisible', [`id: ${q(id)}`], label);
      return [...block('assertVisible', [`id: ${q(id)}`, `index: ${n - 1}`], label), ...block('assertNotVisible', [`id: ${q(id)}`, `index: ${n}`], label)];
    }
    default:
      throw new CompileError(`"${plan.step}": ${a.kind} is not supported in a Maestro flow`);
  }
}

// ---------------------------------------------------------------- run

export interface MaestroCloudOptions {
  context: AppContext;
  cache: PlanCache;
  routines?: RoutineLibrary;
  globals?: GlobalRule[];
  cloud: CloudConfig;
  target: MaestroCloudTarget;
  /** Where flows, caps and vendor output go (inside the run's report folder). */
  workDir: string;
  /** `maestro-runner` (default: over the vendor's Appium hub) or `browserstack-api` (BrowserStack's Maestro builds). */
  runner?: 'maestro-runner' | 'browserstack-api';
  /** maestro-runner command, e.g. ["npx", "maestro-runner"]. */
  maestroRunner?: string[];
  log?: (l: string) => void;
  /** Write the flows (and run the API setup they need) but do not run them on the cloud. */
  compileOnly?: boolean;
  exec?: (bin: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string; code: number }>;
  fetchImpl?: typeof fetch;
}

const stubDriver: Driver = {
  platform: 'mobile',
  name: 'maestro-cloud',
  start: async () => undefined,
  stop: async () => undefined,
  resetApp: async () => undefined,
  openRoute: async () => undefined,
  snapshot: async () => [],
  tap: async () => undefined,
  fill: async () => undefined,
};

async function defaultExec(bin: string, args: string[], env?: NodeJS.ProcessEnv) {
  try {
    const r = await run(bin, args, { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
    return { stdout: r.stdout, stderr: r.stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; message: string };
    if (typeof err.code !== 'number') throw new Error(`${bin}: ${err.message}`);
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code };
  }
}

/** Runs scenarios as compiled Maestro flows on the cloud; returns the same reports as the runner. */
export async function runMaestroCloud(scenarios: Scenario[], o: MaestroCloudOptions): Promise<ScenarioReport[]> {
  const log = o.log ?? (() => undefined);
  const catalog = buildCatalog(o.context);
  const fingerprint = catalogFingerprint(catalog);
  const globals = (o.globals ?? []).map((g) => {
    const plan = o.cache.get(globalPlanKey(g.text, fingerprint, o.context.description));
    if (!plan) throw new Error(`@global "${g.text}" has no reviewed plan; plan it on a local target first`);
    return plan;
  });
  mkdirSync(o.workDir, { recursive: true });
  const app = o.compileOnly ? 'compile-only' : o.cloud.app ? await uploadApp(o.cloud, o.cloud.app, o.fetchImpl) : undefined;
  if (!app) throw new Error(`${o.cloud.provider}: cloud.app is required`);
  const reports: ScenarioReport[] = [];
  let n = 0;
  for (const sc of scenarios) {
    const t0 = performance.now();
    const slug = `${String(++n).padStart(3, '0')}-${sc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    log(`\n  Scenario: ${sc.name}`);
    const world = createWorld();
    const steps: { step: ScenarioStep; plan: StepPlan }[] = [];
    const base = (step: ScenarioStep): StepReport => ({
      step: step.text,
      keyword: step.keyword,
      status: 'skipped',
      source: 'cache',
      actions: [],
      guardFixes: [],
      healed: [],
      ms: 0,
      planMs: 0,
      ...(step.line !== undefined ? { line: step.line } : {}),
      ...(step.origin ? { origin: step.origin } : {}),
      ...(step.background ? { background: true } : {}),
    });
    const expanded = await expandRoutines(sc.steps, o.routines ? { routines: o.routines } : {});
    const stepReports = expanded.map(base);
    let error: string | undefined;
    try {
      await o.context.beforeScenario?.({ driver: stubDriver, world });
      for (const [i, step] of expanded.entries()) {
        if (step.error) throw new CompileError(step.error);
        const plan = o.cache.get(stepPlanKey(step, fingerprint));
        if (!plan) throw new CompileError(`"${step.text}" has no reviewed plan (cloud Maestro runs replay only)`);
        (stepReports[i] as StepReport).actions = plan.actions;
        for (const a of plan.actions) if (a.kind === 'call') await runCall(catalog, world, stubDriver, a);
        steps.push({ step, plan });
      }
      const flow = compileScenario(steps, o.target, catalog.routes, world.facts, globals);
      if (flow.yaml) {
        const file = join(o.workDir, 'flows', `${slug}.yaml`);
        mkdirSync(join(o.workDir, 'flows'), { recursive: true });
        writeFileSync(file, flow.yaml);
        if (o.compileOnly) {
          log(`    compiled → ${file}`);
          stepReports.forEach((r) => (r.status = 'passed'));
          reports.push({ feature: sc.feature, file: sc.uri, name: sc.name, tags: sc.tags, status: 'passed', steps: stepReports, ms: performance.now() - t0 });
          continue;
        }
        const result = (o.runner ?? 'maestro-runner') === 'maestro-runner' ? await viaMaestroRunner(file, slug, app, o) : await viaBrowserStackApi(file, slug, app, o);
        if (!result.passed) {
          error = result.message;
          const failedAt = flow.labels.findIndex((l) => result.message.includes(`${l}:`));
          stepReports.forEach((r, i) => (r.status = failedAt < 0 ? (i === stepReports.length - 1 ? 'failed' : 'passed') : i < failedAt ? 'passed' : i === failedAt ? 'failed' : 'skipped'));
          const failed = stepReports.find((r) => r.status === 'failed');
          if (failed) failed.error = result.message;
        } else stepReports.forEach((r) => (r.status = 'passed'));
      } else stepReports.forEach((r) => (r.status = 'passed'));
    } catch (e) {
      error = e instanceof Error ? redact(e.message, safeCred(o.cloud)) : String(e);
      // The step that cannot be expressed (compile errors), else the first step not run.
      const firstOpen = e instanceof CompileError && e.step !== undefined ? e.step : stepReports.findIndex((r) => r.status === 'skipped');
      const at = stepReports[firstOpen < 0 ? 0 : firstOpen];
      if (at) {
        at.status = 'failed';
        at.error = error;
      }
    }
    for (const r of stepReports) log(`    ${r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '-'} ${r.step}${r.error ? `\n      ! ${r.error}` : ''}`);
    reports.push({
      feature: sc.feature,
      file: sc.uri,
      name: sc.name,
      tags: sc.tags,
      status: error ? 'failed' : 'passed',
      steps: stepReports,
      ms: performance.now() - t0,
      ...(sc.line !== undefined ? { line: sc.line } : {}),
      ...(sc.rule ? { rule: sc.rule } : {}),
    });
  }
  return reports;
}

function safeCred(c: CloudConfig) {
  try {
    return credentials(c);
  } catch {
    return undefined;
  }
}

/** maestro-runner over the vendor's Appium hub (credentials in the URL, as maestro-runner requires). */
async function viaMaestroRunner(flow: string, slug: string, app: string, o: MaestroCloudOptions): Promise<{ passed: boolean; message: string }> {
  const cred = credentials(o.cloud);
  const hub = new URL(appiumHub(o.cloud));
  hub.username = encodeURIComponent(cred.username);
  hub.password = encodeURIComponent(cred.accessKey);
  const caps = cloudAppiumCapabilities(o.cloud, o.target.capabilities, { app, sessionName: `e2e-ai ${slug}` });
  // Keep credentials out of the caps file (they travel in the hub URL).
  for (const k of ['sauce:options', 'bstack:options']) {
    const v = caps[k] as Record<string, unknown> | undefined;
    if (v) {
      delete v.username;
      delete v.accessKey;
      delete v.userName;
    }
  }
  const capsFile = join(o.workDir, 'caps', `${slug}.json`);
  mkdirSync(join(o.workDir, 'caps'), { recursive: true });
  writeFileSync(capsFile, JSON.stringify(caps, null, 2), { mode: 0o600 });
  const out = join(o.workDir, 'maestro', slug);
  const [bin, ...pre] = o.maestroRunner ?? ['maestro-runner'];
  const r = await (o.exec ?? defaultExec)(bin as string, [...pre, '--driver', 'appium', '--appium-url', hub.toString(), '--caps', capsFile, 'test', '--output', out, '--flatten', flow]);
  const junit = readJUnit(out);
  const passed = r.code === 0 && !junit.failed;
  return { passed, message: redact(junit.message || `${r.stderr || r.stdout}`.trim().slice(-600), cred) };
}

/** First failure of the JUnit report maestro-runner writes into --output. */
export function readJUnit(dir: string): { failed: boolean; message: string } {
  if (!existsSync(dir)) return { failed: false, message: '' };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    const xml = readFileSync(join(dir, f), 'utf8');
    const m = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(xml);
    if (m) {
      const attrs = m[2] ?? m[5] ?? '';
      const msg = /message="([^"]*)"/.exec(attrs)?.[1] ?? '';
      return { failed: true, message: `${msg} ${(m[3] ?? '').trim()}`.trim().replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') };
    }
  }
  return { failed: false, message: '' };
}

/** BrowserStack's Maestro builds: upload the flow as a test suite, start a build, poll it. */
async function viaBrowserStackApi(flow: string, slug: string, _app: string, o: MaestroCloudOptions): Promise<{ passed: boolean; message: string }> {
  if (o.cloud.provider !== 'browserstack') throw new Error('runner "browserstack-api" needs provider "browserstack"');
  const f = o.fetchImpl ?? fetch;
  const cred = credentials(o.cloud);
  const auth = { authorization: basicAuth(cred) };
  const api = `${apiBase(o.cloud)}/app-automate/maestro/v2`;
  // BrowserStack wants a zip whose top folder holds the flows.
  const suiteDir = join(o.workDir, 'suites', slug);
  mkdirSync(suiteDir, { recursive: true });
  writeFileSync(join(suiteDir, 'flow.yaml'), readFileSync(flow));
  const zip = join(o.workDir, 'suites', `${slug}.zip`);
  await run('zip', ['-r', '-q', zip, slug], { cwd: join(o.workDir, 'suites') });
  const upload = async (path: string, file: string) => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)]), file.split('/').pop() as string);
    const res = await f(`${api}/${path}`, { method: 'POST', headers: auth, body: form });
    const j = (await res.json()) as Record<string, string>;
    if (!res.ok) throw new Error(`BrowserStack ${path} upload failed: ${redact(JSON.stringify(j), cred)}`);
    return j;
  };
  const appRef = o.cloud.app && !/^bs:\/\//.test(o.cloud.app) ? (await upload('app', o.cloud.app)).app_url : o.cloud.app;
  const suite = (await upload('test-suite', zip)).test_suite_url;
  const device = `${o.cloud.device ?? (o.target.os === 'android' ? 'Google Pixel 8' : 'iPhone 15')}-${o.cloud.platformVersion ?? (o.target.os === 'android' ? '14.0' : '17')}`;
  const start = await f(`${api}/${o.target.os}/build`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ app: appRef, testSuite: suite, devices: [device], execute: [`${slug}/flow.yaml`], ...(o.cloud.project ? { project: o.cloud.project } : {}), ...(o.cloud.build ? { buildTag: o.cloud.build } : {}), ...(o.cloud.options ?? {}) }),
  });
  const started = (await start.json()) as { build_id?: string; message?: string };
  if (!started.build_id) throw new Error(`BrowserStack Maestro build did not start: ${redact(JSON.stringify(started), cred)}`);
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const b = (await (await f(`${api}/builds/${started.build_id}`, { headers: auth })).json()) as { status?: string; devices?: { sessions?: { status?: string; id?: string }[] }[] };
    if (b.status && !['running', 'queued'].includes(b.status)) {
      const sessions = (b.devices ?? []).flatMap((d) => d.sessions ?? []);
      const passed = b.status === 'passed' || (sessions.length > 0 && sessions.every((s) => s.status === 'passed'));
      return { passed, message: passed ? '' : `BrowserStack Maestro build ${started.build_id}: ${b.status}` };
    }
  }
  return { passed: false, message: `BrowserStack Maestro build ${started.build_id} did not finish in 20 minutes` };
}
