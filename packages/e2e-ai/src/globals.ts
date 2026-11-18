// Plans an `@global` rule once: WHEN (texts that identify the situation on screen) and DO (UI
// actions). Checking the trigger at run time is deterministic: every trigger text must be visible.
// The model only proposes; the trigger texts must appear in the docs or in the rule itself, and the
// actions are limited to tap/fill — a standing rule never creates data, navigates or asserts.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import type { Catalog } from './catalog.ts';
import { isGlobalSource, parseGlobals, type GlobalProblem, type GlobalRule } from './globalSyntax.ts';
import type { JsonSchema, Llm } from './llm.ts';
import { planStep } from './planner.ts';
import type { PlannedAction } from './types.ts';

/** Bump when @global planning or its guards change: cached @global plans expire (step plans do not). */
export const GLOBAL_PLANNER_VERSION = 2;

export interface GlobalPlanResult {
  when: string[];
  actions: PlannedAction[];
  guardFixes: string[];
}

const SYSTEM = `You turn ONE standing rule for an app UI test into a trigger and an action.
The rule applies whenever a certain screen, sheet or dialog is visible, for example a consent sheet,
a cookie banner or a "What's new" popup.
- when_visible: 1 to 3 short texts (2-6 words each) that are shown on screen exactly when the rule
  applies. Copy them word for word from the Screens description below; never invent text.
- do: ONE imperative test step that carries the rule out on that screen, naming the button or field,
  e.g. tap No thanks / tap Close / fill Name with "x" then tap Save.
Answer with JSON only.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    when_visible: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    do: { type: 'string' },
  },
  required: ['when_visible', 'do'],
};

const norm = (s: string) => s.toLowerCase().replace(/[“”"'‘’]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Keeps trigger texts the docs (or the rule) actually contain. A trigger the model invented would
 * never match — or worse, match an unrelated screen — so it is dropped, not trusted.
 */
export function groundTriggers(when: string[], docs: string, rule: string, fixes: string[]): string[] {
  const hay = `${norm(docs)}\n${norm(rule)}`;
  // Exact on-screen texts are written "quoted" or **bold** in the guide; its prose describes the
  // screen in other words ("asks to allow usage statistics"), which never appear on screen. When
  // some proposed triggers are such literals, the others are dropped.
  const literals = [...`${docs}\n${rule}`.matchAll(/"([^"\n]{3,})"|“([^”\n]{3,})”|\*\*([^*\n]{3,})\*\*/g)].map((m) => norm(m[1] ?? m[2] ?? m[3] ?? ''));
  const isLiteral = (t: string) => literals.some((l) => l.includes(norm(t)));
  const anyLiteral = when.some((w) => isLiteral(w.replace(/^["'“‘]+|["'”’.]+$/g, '').trim()));
  const out: string[] = [];
  for (const raw of when) {
    const t = raw.replace(/^["'“‘]+|["'”’.]+$/g, '').trim();
    if (t.length < 3) {
      fixes.push(`dropped trigger "${raw}" (too short)`);
      continue;
    }
    if (!hay.includes(norm(t))) {
      fixes.push(`dropped trigger "${raw}" (not in the docs)`);
      continue;
    }
    if (anyLiteral && !isLiteral(t)) {
      fixes.push(`dropped trigger "${raw}" (describes the screen; not a quoted on-screen text)`);
      continue;
    }
    if (!out.some((o) => norm(o) === norm(t))) out.push(t);
  }
  return out;
}

export async function planGlobal(llm: Llm, cat: Catalog, docs: string, rule: GlobalRule): Promise<GlobalPlanResult> {
  const fixes: string[] = [];
  const raw = await llm.json<{ when_visible?: string[]; do?: string }>({
    system: `${SYSTEM}\n\nApp description and screens:\n${docs}`,
    prompt: `Rule: ${rule.text}\nOutput:`,
    schema: SCHEMA,
  });
  const when = groundTriggers(raw.when_visible ?? [], docs, rule.text, fixes);
  if (when.length === 0) {
    throw new Error(
      `@global "${rule.text}": no trigger text found in the docs — describe that screen (its visible texts and buttons) under "## Screens" in the app guide`,
    );
  }
  const step = (raw.do ?? '').trim();
  if (!step) throw new Error(`@global "${rule.text}": the model gave no action`);
  const planned = await planStep(llm, cat, { step, keyword: 'action', facts: {} });
  fixes.push(...planned.guardFixes);
  const actions = planned.actions.filter((a) => a.kind === 'tap' || a.kind === 'fill');
  if (actions.length < planned.actions.length) fixes.push('kept only tap/fill (a @global never calls APIs, navigates or asserts)');
  if (actions.length === 0) throw new Error(`@global "${rule.text}": "${step}" planned no tap or fill`);
  return { when, actions, guardFixes: [`do: ${step}`, ...fixes] };
}

/**
 * Splits `.feature` files into Gherkin features and `@global` rule files (any file whose first
 * content line is `@global`). Every rule applies to every scenario of the run.
 */
export function loadGlobals(files: string[], root = process.cwd()): { features: string[]; rules: GlobalRule[]; problems: GlobalProblem[] } {
  const features: string[] = [];
  const rules: GlobalRule[] = [];
  const problems: GlobalProblem[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!isGlobalSource(src)) {
      features.push(file);
      continue;
    }
    const rel = relative(root, file);
    const r = parseGlobals(src, rel.startsWith('..') ? file : rel);
    rules.push(...r.rules);
    problems.push(...r.problems);
  }
  return { features, rules, problems };
}
