// The plan cache ("lockfile"): every planned step is stored with the element each target resolved
// to. Replays need no LLM at all and are deterministic; a target that stops matching is re-grounded
// (healed) and written back. Commit the file and review its diffs like a snapshot.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { StepPlan } from './types.ts';

export interface PlanCache {
  get(key: string): StepPlan | undefined;
  set(key: string, plan: StepPlan): void;
  save(): void;
  readonly path: string;
}

export function planKey(step: string, keyword: string, fingerprint: string): string {
  return createHash('sha256').update(`${keyword}\n${step}\n${fingerprint}`).digest('hex').slice(0, 16);
}

/**
 * `disabled` (--no-cache): nothing is read or reused — every step, every time, is planned by the
 * model (Background and routine steps repeated across scenarios too) — and nothing is written,
 * so the reviewed plans file is never touched by an evaluation run.
 */
export function openPlanCache(path: string, opts: { disabled?: boolean; record?: boolean } = {}): PlanCache {
  if (opts.disabled) return { path, get: () => undefined, set() {}, save() {} };
  // `record`: plan every step (never read) but keep what was planned (benchmark: warms the next mode).
  const data: Record<string, StepPlan> = !opts.record && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  let dirty = false;
  return {
    path,
    get: (k) => (opts.record ? undefined : data[k]),
    set(k, plan) {
      data[k] = plan;
      dirty = true;
    },
    save() {
      if (!dirty) return;
      mkdirSync(dirname(path), { recursive: true });
      const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
      dirty = false;
    },
  };
}
