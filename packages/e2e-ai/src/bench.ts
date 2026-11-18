#!/usr/bin/env node
// Planner benchmark: labelled Gherkin steps → plan → (for UI actions) grounding on recorded
// snapshots, per model, with and without the pockets' worked examples. No app needed.
//   node src/bench.ts --config e2e/e2e-ai.config.json --cases e2e/bench/cases.json
//        --snapshots e2e/bench/snapshots.json --models qwen3:0.6b,qwen3:1.7b [--out r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCatalog, type Catalog } from './catalog.ts';
import { loadConfig } from './config.ts';
import { contextFromDocs } from './docs.ts';
import { ground, groundGroup } from './grounder.ts';
import { createLlm, type Llm } from './llm.ts';
import { planStep } from './planner.ts';
import type { AppContext, PlannedAction, UiElement } from './types.ts';

interface GoldAction {
  kind: string;
  fn?: string;
  route?: string;
  args?: Record<string, unknown>;
  value?: string;
  count?: number;
  testId?: string;
  group?: string;
}

export interface Case {
  id: string;
  keyword: 'context' | 'action' | 'outcome';
  step: string;
  paraphrase?: boolean;
  screen?: string;
  facts?: Record<string, unknown>;
  table?: Record<string, string>[];
  gold: GoldAction[];
}

const eq = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b;

async function check(
  c: Case,
  plan: PlannedAction[],
  snap: UiElement[] | undefined,
  llm: Llm,
): Promise<{ kindsOk: boolean; ok: boolean; groundTotal: number; groundOk: number; why: string[] }> {
  const why: string[] = [];
  const kindsOk = plan.length === c.gold.length && plan.every((a, i) => a.kind === c.gold[i]?.kind);
  if (!kindsOk) why.push(`kinds ${plan.map((a) => a.kind).join(',')} ≠ ${c.gold.map((g) => g.kind).join(',')}`);
  let ok = kindsOk;
  const fail = (msg: string) => {
    ok = false;
    why.push(msg);
  };
  let groundTotal = 0;
  let groundOk = 0;
  for (let i = 0; i < c.gold.length; i++) {
    const g = c.gold[i] as GoldAction;
    const a = plan[i];
    if (g.testId || g.group) groundTotal++;
    if (!a || a.kind !== g.kind) continue;
    if (g.fn && a.fn !== g.fn) fail(`fn ${a.fn}`);
    if (g.route && a.route !== g.route) fail(`route ${a.route}`);
    for (const [k, v] of Object.entries(g.args ?? {})) {
      if (!eq(a.args?.[k], v)) fail(`arg ${k}=${JSON.stringify(a.args?.[k])}`);
    }
    if (g.args && g.args.done === undefined && a.args?.done === true) fail('arg done=true');
    if (g.value !== undefined && !eq(a.value, g.value)) fail(`value ${JSON.stringify(a.value)}`);
    if (g.count !== undefined && a.count !== g.count) fail(`count ${a.count}`);
    if (g.testId && snap) {
      const desc = a.kind === 'fill' ? a.target || '' : a.value && a.target && !a.target.includes(a.value) ? `${a.target} "${a.value}"` : a.target || a.value || '';
      const r = await ground(snap, desc, a.kind === 'fill' ? 'fill' : 'tap', { llm });
      if (r.element?.testId === g.testId) groundOk++;
      else fail(`grounded ${r.element?.testId ?? 'nothing'} for "${desc}"`);
    }
    if (g.group && snap) {
      const grp = groundGroup(snap, a.target ?? '');
      if (grp?.key === g.group) groundOk++;
      else fail(`group ${grp?.key ?? 'none'}`);
    }
  }
  return { kindsOk, ok, groundTotal, groundOk, why };
}

function stripExamples(ctx: AppContext): AppContext {
  return { ...ctx, pockets: ctx.pockets.map((p) => ({ ...p, examples: [] })) };
}

export interface PlannerBenchSummary {
  model: string;
  set: string;
  mode: string;
  cases: number;
  exact: number;
  exactCanonical: number;
  exactParaphrase: number;
  kinds: number;
  grounding: number | null;
  guardFixes: number;
  msPerStep: number;
  llmCalls: number;
  tokensPerStep: number;
  failures: string[];
}

/** Scores one model on labelled steps against the docs-derived catalog. */
export async function benchPlanner(opts: {
  ctx: AppContext;
  cases: Case[];
  snapshots: Record<string, UiElement[]>;
  llm: Llm;
  examples: boolean;
  set?: string;
}): Promise<{ summary: PlannerBenchSummary; rows: unknown[] }> {
  const { llm, cases, snapshots } = opts;
  const cat: Catalog = buildCatalog(opts.examples ? opts.ctx : stripExamples(opts.ctx));
  // Warm-up: load weights so the first case's latency is not a cold start.
  await llm.json({ system: 'Reply with {"ok":true}', prompt: 'ok', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } });
  const before = { ...llm.stats };
  const rows = [];
  for (const c of cases) {
    const t0 = performance.now();
    let plan: PlannedAction[] = [];
    let fixes: string[] = [];
    let error: string | undefined;
    try {
      const r = await planStep(llm, cat, { step: c.step, keyword: c.keyword, facts: c.facts ?? {}, ...(c.table ? { table: c.table } : {}) });
      plan = r.actions;
      fixes = r.guardFixes;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const res = await check(c, plan, c.screen ? snapshots[c.screen] : undefined, llm);
    rows.push({ id: c.id, paraphrase: !!c.paraphrase, ms: performance.now() - t0, ...res, fixes, error, plan });
  }
  const n = rows.length;
  const pct = (k: number) => Math.round((100 * k) / Math.max(1, n));
  const gT = rows.reduce((s, r) => s + r.groundTotal, 0);
  const gO = rows.reduce((s, r) => s + r.groundOk, 0);
  const para = rows.filter((r) => r.paraphrase);
  return {
    summary: {
      model: llm.model,
      set: opts.set ?? 'cases',
      mode: opts.examples ? 'examples' : 'zero-shot',
      cases: n,
      exact: pct(rows.filter((r) => r.ok).length),
      exactCanonical: Math.round((100 * rows.filter((r) => !r.paraphrase && r.ok).length) / Math.max(1, n - para.length)),
      exactParaphrase: Math.round((100 * para.filter((r) => r.ok).length) / Math.max(1, para.length)),
      kinds: pct(rows.filter((r) => r.kindsOk).length),
      grounding: gT ? Math.round((100 * gO) / gT) : null,
      guardFixes: rows.reduce((s, r) => s + r.fixes.length, 0),
      msPerStep: Math.round(rows.reduce((s, r) => s + r.ms, 0) / Math.max(1, n)),
      llmCalls: llm.stats.calls - before.calls,
      tokensPerStep: Math.round((llm.stats.promptTokens - before.promptTokens + llm.stats.outputTokens - before.outputTokens) / Math.max(1, n)),
      failures: rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error ?? r.why.join('; ')}`),
    },
    rows,
  };
}

async function main(): Promise<void> {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] ?? '']] : acc), []),
  );
  const cfg = loadConfig(args.config ?? 'e2e/e2e-ai.config.json');
  const ctx: AppContext = contextFromDocs({
    apiDocs: cfg.docs.api.map((f) => ({ md: readFileSync(f, 'utf8'), file: f })),
    guide: { md: readFileSync(cfg.docs.guide, 'utf8'), file: cfg.docs.guide },
    baseUrl: cfg.api.baseUrl,
  });
  const cases = JSON.parse(readFileSync(resolve(args.cases ?? 'e2e/bench/cases.json'), 'utf8')) as Case[];
  const snapshots = JSON.parse(readFileSync(resolve(args.snapshots ?? 'e2e/bench/snapshots.json'), 'utf8')) as Record<string, UiElement[]>;
  const models = (args.models ?? cfg.model.name).split(',');
  const modes = (args.modes ?? 'examples,zero-shot').split(',');
  const results: unknown[] = [];
  for (const model of models) {
    for (const mode of modes) {
      const r = await benchPlanner({ ctx, cases, snapshots, llm: createLlm({ ...cfg.model, name: model }), examples: mode === 'examples' });
      const x = r.summary;
      console.log(
        `${model.padEnd(40)} ${mode.padEnd(10)} exact ${String(x.exact).padStart(3)}% (canon ${x.exactCanonical}%, para ${x.exactParaphrase}%) kinds ${x.kinds}% ground ${x.grounding}% fixes ${x.guardFixes} ${x.msPerStep}ms/step`,
      );
      results.push(r);
    }
  }
  if (args.out) writeFileSync(args.out, `${JSON.stringify(results, null, 2)}\n`);
}

// Library when imported (the benchmark report), CLI when run directly.
if (import.meta.url === `file://${process.argv[1]}`) await main();
