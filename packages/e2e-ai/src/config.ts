// e2e-ai.config.json: the only setup a team writes besides Markdown docs, .feature and .routine
// files. Strings may use ${ENV} / ${ENV:-default}; relative paths resolve from the config's folder.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ModelConfig } from './llm.ts';
import type { TargetConfig } from './drivers/index.ts';

export type { TargetConfig };

export interface E2eConfig {
  dir: string; // folder of the config file
  model: ModelConfig;
  docs: { api: string[]; guide: string };
  api: { baseUrl: string };
  features: string;
  routines: string;
  plans: string;
  reports: { templates: string; runs: string; defaultTemplate: string; model?: ModelConfig };
  targets: Record<string, TargetConfig>;
  /** screenshots: 'steps' | 'failures' | 'none'; video: 'mobile' | 'all' | 'none'. */
  media: { screenshots: string; video: string; stepPauseMs?: number };
  /** Default model list for a bare `--benchmark` ("name"@endpoint entries). */
  benchmark?: {
    models: string[];
    modes?: string[];
    freshScenario?: string;
    environment?: string;
    /** Docker container to sample memory from (e.g. the CI-simulation Ollama). */
    memoryProbe?: { container: string; context?: string };
  };
  /** Labelled steps the planner benchmark scores (optional). */
  bench?: { cases: string[]; snapshots: string };
}

const expand = (s: string): string =>
  s.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, k: string, d: string | undefined) => process.env[k] ?? d ?? '');

function expandAll<T>(v: T): T {
  if (typeof v === 'string') return expand(v) as T;
  if (Array.isArray(v)) return v.map(expandAll) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandAll(x)])) as T;
  return v;
}

export function loadConfig(path = 'e2e/e2e-ai.config.json'): E2eConfig {
  const file = resolve(path);
  if (!existsSync(file)) throw new Error(`no config at ${file}`);
  const raw = expandAll(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const dir = dirname(file);
  const p = (x: string) => (isAbsolute(x) ? x : resolve(dir, x));
  const docs = raw.docs as { api: string[]; guide: string };
  const reports = (raw.reports ?? {}) as { templates?: string; runs?: string; defaultTemplate?: string; model?: ModelConfig };
  const targets = raw.targets as Record<string, TargetConfig>;
  for (const t of Object.values(targets)) {
    if (t.mcp?.cwd) t.mcp.cwd = p(t.mcp.cwd);
    const d = t.driver as { cwd?: string } | undefined;
    if (d?.cwd) d.cwd = p(d.cwd);
  }
  return {
    dir,
    model: raw.model as ModelConfig,
    docs: { api: docs.api.map(p), guide: p(docs.guide) },
    api: raw.api as { baseUrl: string },
    features: p((raw.features as string | undefined) ?? 'features'),
    routines: p((raw.routines as string | undefined) ?? 'routines'),
    plans: p((raw.plans as string | undefined) ?? '.plans/plans.json'),
    reports: {
      templates: p(reports.templates ?? 'reports/templates'),
      runs: p(reports.runs ?? 'reports/runs'),
      defaultTemplate: reports.defaultTemplate ?? 'engineering',
      ...(reports.model ? { model: reports.model } : {}),
    },
    targets,
    media: { screenshots: 'steps', video: 'all', ...((raw.media ?? {}) as object) },
    ...(raw.benchmark?.models ? { benchmark: raw.benchmark as never } : {}),
    ...(raw.bench
      ? { bench: { cases: (raw.bench.cases as string[]).map(p), snapshots: p(raw.bench.snapshots as string) } }
      : {}),
  };
}
