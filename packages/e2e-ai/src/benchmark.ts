// `e2e-ai run --benchmark '"m1">>endpoint;"m2">>endpoint'`: every model runs the same suite with an
// EMPTY plan cache (so it plans every step itself, from the docs), then — when the config has
// labelled cases — the planner benchmark on those cases. Results land in
// reports/runs/<slug>-benchmark/: one run report per model (models/<name>/) and a comparison
// rendered from reports/templates/benchmark/*.html. The recommendation is computed (pass rate →
// held-out exactness → speed); the pocket model only explains it, in checked prose.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import type { ScenarioReport } from './runner.ts';
import type { LlmStats, ModelConfig } from './llm.ts';
import type { PlannerBenchSummary } from './bench.ts';

export type BenchmarkMode = 'no-cache' | 'cache' | 'one-fresh';

export interface Stat {
  n: number;
  mean: number;
  median: number;
}

export interface ModeResult {
  mode: BenchmarkMode;
  /** one-fresh: the scenario planned from scratch. */
  freshScenario?: string;
  durationMs: number;
  scenarios: number;
  passed: number;
  stepsCached: number;
  stepsPlanned: number;
  /** Whole step (plan + act + check), split by where the plan came from. */
  stepMs: { cached: Stat; planned: Stat };
  /** Model time for planned steps only. */
  planMs: Stat;
  modelCalls: number;
  memory: { modelPeakGB: number | null; containerPeakGB: number | null };
  report: string;
}

export function stat(values: number[]): Stat {
  if (values.length === 0) return { n: 0, mean: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return { n: values.length, mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length), median: Math.round(median) };
}

export function modeResult(
  mode: BenchmarkMode,
  reports: ScenarioReport[],
  durationMs: number,
  modelCalls: number,
  memory: ModeResult['memory'],
  report: string,
  freshScenario?: string,
): ModeResult {
  const steps = reports.flatMap((r) => r.steps).filter((st) => st.status !== 'skipped');
  const cached = steps.filter((st) => st.source === 'cache');
  const planned = steps.filter((st) => st.source === 'llm');
  return {
    mode,
    ...(freshScenario ? { freshScenario } : {}),
    durationMs,
    scenarios: reports.length,
    passed: reports.filter((r) => r.status === 'passed').length,
    stepsCached: cached.length,
    stepsPlanned: planned.length,
    stepMs: { cached: stat(cached.map((st) => st.ms)), planned: stat(planned.map((st) => st.ms)) },
    planMs: stat(planned.map((st) => st.planMs)),
    modelCalls,
    memory,
    report,
  };
}

/**
 * Polls memory while a run is going: the model's size as Ollama reports it (any Ollama endpoint) and,
 * when configured, a Docker container's usage (`docker stats`), keeping the peaks.
 */
export function startMemoryProbe(opts: { endpoint: string; model: string; docker?: { container: string; context?: string } }) {
  const base = opts.endpoint.replace(/\/v1\/?$/, '');
  let modelPeak: number | null = null;
  let containerPeak: number | null = null;
  const run = promisify(execFile);
  const tick = async () => {
    try {
      const ps = (await (await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2000) })).json()) as { models?: { name: string; size: number }[] };
      const m = ps.models?.find((x) => x.name === opts.model || x.name === `${opts.model}:latest`);
      if (m) modelPeak = Math.max(modelPeak ?? 0, m.size / 1e9);
    } catch {
      // not an Ollama endpoint
    }
    if (opts.docker) {
      try {
        const { stdout } = await run('docker', [
          ...(opts.docker.context ? ['--context', opts.docker.context] : []),
          'stats', '--no-stream', '--format', '{{.MemUsage}}', opts.docker.container,
        ]);
        const m = /([\d.]+)\s*(GiB|MiB|KiB|GB|MB)/.exec(stdout);
        if (m) {
          const v = Number(m[1]) * ({ GiB: 1.073741824, GB: 1, MiB: 0.001048576, MB: 0.001, KiB: 0.000001024 } as Record<string, number>)[m[2] as string]!;
          containerPeak = Math.max(containerPeak ?? 0, v);
        }
      } catch {
        // docker unavailable
      }
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  void tick();
  return {
    async stop(): Promise<ModeResult['memory']> {
      clearInterval(timer);
      await tick();
      const r = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
      return { modelPeakGB: r(modelPeak), containerPeakGB: r(containerPeak) };
    },
  };
}

export interface ModelResult {
  name: string;
  endpoint: string;
  info: { parameters?: string; quantization?: string; sizeGB?: number };
  report: string; // relative link to the model's own run report
  suite: {
    scenarios: number;
    passed: number;
    failed: number;
    passRate: number;
    steps: number;
    planned: number;
    guardFixes: number;
    replans: number;
    durationMs: number;
    llm: LlmStats;
    msPerPlannedStep: number;
    error?: string;
  };
  scenarios: { id: string; key: string; name: string; file: string; line?: number; status: 'passed' | 'failed'; error?: string }[];
  planner: PlannerBenchSummary[];
  /** Per-mode runs (no-cache → cache → one-fresh) when the benchmark ran modes. */
  modes?: ModeResult[];
}

export interface BenchmarkData {
  title: string;
  generatedAt: string;
  startedAt: string;
  durationMs: number;
  target: string;
  platform: string;
  tags: string | null;
  features: string[];
  models: ModelResult[];
  /** Where the models ran (e.g. "CI simulation: 4 vCPU, 16 GB, CPU only"). */
  environment?: string;
  recommended: { name: string; why: string } | null;
  ai: { sections: Record<string, { text: string; accepted: boolean; reason?: string; model?: string; rejected?: string }>; model: string | null };
}

export function modelResult(
  cfg: ModelConfig,
  info: ModelResult['info'],
  reports: ScenarioReport[],
  stats: LlmStats,
  durationMs: number,
  link: string,
  planner: PlannerBenchSummary[],
  error?: string,
): ModelResult {
  const steps = reports.flatMap((r) => r.steps);
  const planned = steps.filter((s) => s.source === 'llm').length;
  const passed = reports.filter((r) => r.status === 'passed').length;
  return {
    name: cfg.name,
    endpoint: cfg.endpoint,
    info,
    report: link,
    suite: {
      scenarios: reports.length,
      passed,
      failed: reports.length - passed,
      passRate: reports.length ? Math.round((100 * passed) / reports.length) : 0,
      steps: steps.length,
      planned,
      guardFixes: steps.reduce((n, s) => n + s.guardFixes.filter((g) => !g.startsWith('re-planned')).length, 0),
      replans: steps.reduce((n, s) => n + s.guardFixes.filter((g) => g.startsWith('re-planned')).length, 0),
      durationMs,
      llm: stats,
      msPerPlannedStep: planned ? Math.round(stats.ms / planned) : 0,
      ...(error ? { error } : {}),
    },
    scenarios: reports.map((r, i) => {
      const failed = r.steps.find((s) => s.status === 'failed');
      return {
        id: `s${i + 1}`,
        key: `${r.file}:${r.line ?? ''}:${r.name}`,
        name: r.name,
        file: r.file,
        ...(r.line !== undefined ? { line: r.line } : {}),
        status: r.status,
        ...(failed?.error ? { error: failed.error } : {}),
      };
    }),
    planner,
  };
}

/** Deterministic choice: most scenarios passed, then fewest guard repairs + re-plans, then speed. */
export function recommend(models: ModelResult[]): BenchmarkData['recommended'] {
  const ok = models.filter((m) => !m.suite.error);
  if (ok.length === 0) return null;
  const repairs = (m: ModelResult) => m.suite.guardFixes + m.suite.replans;
  const best = [...ok].sort(
    (a, b) => b.suite.passRate - a.suite.passRate || repairs(a) - repairs(b) || a.suite.msPerPlannedStep - b.suite.msPerPlannedStep,
  )[0] as ModelResult;
  const why = [`${best.suite.passed}/${best.suite.scenarios} scenarios passed`, `${repairs(best)} guard repairs/re-plans`];
  why.push(`${best.suite.msPerPlannedStep} ms per planned step`);
  return { name: best.name, why: why.join(', ') };
}

/** True statements for the comparison prose (the model may only rephrase these). */
export function benchmarkFacts(d: BenchmarkData): string[] {
  const out: string[] = [`${d.models.length} models ran the same ${d.models[0]?.suite.scenarios ?? 0} scenarios on ${d.target}, each planning every step itself from the docs.`];
  for (const m of d.models) {
    if (m.suite.error) {
      out.push(`${m.name} could not run: ${m.suite.error}`);
      continue;
    }
    const size = m.info.sizeGB ? ` (${m.info.parameters ?? ''} ${m.info.quantization ?? ''}, ${m.info.sizeGB} GB)`.replace(/\s+/g, ' ') : '';
    const p = m.planner.map((x) => `${x.exact}% exact on the ${x.set} set (${x.cases} steps)`).join(', ');
    out.push(
      `${m.name}${size}: ${m.suite.passed} of ${m.suite.scenarios} scenarios passed (${m.suite.passRate}%), ${m.suite.planned} steps planned in ${Math.round(m.suite.llm.ms / 1000)} s of model time (${m.suite.msPerPlannedStep} ms per step), ${m.suite.guardFixes} guard repairs, ${m.suite.replans} re-plans${p ? `; planner benchmark: ${p}` : ''}.`,
    );
  }
  for (const m of d.models) {
    for (const x of m.modes ?? []) {
      const mem = x.memory.containerPeakGB ?? x.memory.modelPeakGB;
      out.push(
        `${m.name}, ${x.mode}${x.freshScenario ? ` ("${x.freshScenario}" planned fresh)` : ''}: ${x.passed} of ${x.scenarios} passed in ${Math.round(x.durationMs / 1000)} s; ` +
          `${x.stepsPlanned} planned steps (mean ${x.stepMs.planned.mean} ms, median ${x.stepMs.planned.median} ms), ` +
          `${x.stepsCached} cached steps (mean ${x.stepMs.cached.mean} ms, median ${x.stepMs.cached.median} ms)${mem !== null ? `; peak memory ${mem} GB` : ''}.`,
      );
    }
  }
  if (d.recommended) out.push(`Recommended by the rule (pass rate, then fewest repairs, then speed): ${d.recommended.name} — ${d.recommended.why}.`);
  const diffs = new Map<string, string[]>();
  for (const m of d.models) for (const s of m.scenarios) if (s.status === 'failed') diffs.set(s.name, [...(diffs.get(s.name) ?? []), m.name]);
  for (const [name, who] of diffs) out.push(`"${name}" failed with ${who.join(', ')}.`);
  return out;
}

export function renderBenchmarkHtml(templatePath: string, d: BenchmarkData): string {
  const template = readFileSync(templatePath, 'utf8');
  const json = JSON.stringify(d).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (!template.includes('/*__REPORT_DATA__*/null')) throw new Error(`${templatePath} lacks the /*__REPORT_DATA__*/null marker`);
  return template.replace('/*__REPORT_DATA__*/null', () => json);
}
