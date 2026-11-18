// Step → plan. Two small, grammar-constrained LLM calls instead of one big free-form one:
//   1. decompose: the step's action list (kind, fn, route, target, value, count), with `fn` and
//      `route` constrained to the catalog's names, so the model cannot call something that is not
//      there;
//   2. args: for each `call`, the function's own parameter schema.
// Then deterministic guards repair the classic small-model failure (a value that is in neither the
// step nor the facts) before anything runs.
import { describeCatalog, type Catalog } from './catalog.ts';
import type { JsonSchema, Llm } from './llm.ts';
import { ACTION_KINDS, type ActionKind, type PlannedAction } from './types.ts';

/** Bump when guards or prompts change: cached plans made by an older planner expire. */
export const PLANNER_VERSION = 7;

export interface PlanInput {
  step: string;
  keyword: 'context' | 'action' | 'outcome' | 'unknown';
  facts: Record<string, unknown>;
  table?: Record<string, string>[];
  /** Why the previous plan for this step failed when executed (plan-repair loop). */
  feedback?: string;
}

export interface PlanResult {
  actions: PlannedAction[];
  guardFixes: string[];
}

const KEYWORD_LABEL = { context: 'Given', action: 'When', outcome: 'Then', unknown: 'Step' } as const;

const RULES = `You convert ONE Gherkin test step into a JSON list of test actions for a UI test robot.

Action kinds:
- call: run a setup function from the catalog (fn = its exact name). Use for "Given" steps that create data or start a signed-in session. Never use call for "When" or "Then" steps.
- open: open a screen by route name (route = its exact name).
- tap: press a button, link, checkbox or row. target = short description of the element, e.g. "Add note button".
- fill: type text into an input. target = the input's label, value = the text to type.
- expect_visible: something must be shown. value = the exact text that must be on screen; target = what it is.
- expect_hidden: something must NOT be shown. value = the exact text that must be absent; target = what it is.
- expect_count: target = what is counted (e.g. "notes in the list"), count = the number.

Rules:
- Copy quoted values exactly, without the quotes. Never invent values. Take remembered values (like a password) from Facts.
- A step can need several actions (e.g. fill two fields then tap a button), in order.
- "Then" steps only use expect_* actions.
- Leave unused fields empty: fn "", route "", target "", value "", count 0.`;

/** Words that make an `open` action legitimate in a step. */
export const NAVIGATION = /\b(open|opens|opening|go|goes|going|navigate|navigates|visit|visits|am on|is on|start on|starts on|land on|back to|return to|screen|page)\b/i;

/** Collapses consecutive identical actions (a common small-model stutter: call,call,call). */
export function dedupe<T extends object>(actions: T[], fixes: string[]): T[] {
  const out: T[] = [];
  for (const a of actions) {
    const prev = out[out.length - 1];
    if (prev && JSON.stringify(prev) === JSON.stringify(a)) {
      fixes.push('dropped duplicate action');
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Which kinds a step may use, by its Gherkin keyword: the grammar, not the prompt, enforces it. */
export function kindsFor(keyword: PlanInput['keyword']): readonly ActionKind[] {
  if (keyword === 'outcome') return ACTION_KINDS.filter((k) => k.startsWith('expect_'));
  if (keyword === 'action') return ACTION_KINDS.filter((k) => k !== 'call' && !k.startsWith('expect_'));
  return ACTION_KINDS;
}

function stepSchema(fnNames: string[], routeNames: string[], kinds: readonly ActionKind[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...kinds] },
            fn: { type: 'string', enum: ['', ...fnNames] },
            route: { type: 'string', enum: ['', ...routeNames] },
            target: { type: 'string' },
            value: { type: 'string' },
            count: { type: 'integer' },
          },
          required: ['kind', 'fn', 'route', 'target', 'value', 'count'],
        },
      },
    },
    required: ['actions'],
  };
}

interface RawAction {
  kind: ActionKind;
  fn: string;
  route: string;
  target: string;
  value: string;
  count: number;
}

function exampleBlock(cat: Catalog): string {
  if (cat.examples.length === 0) return '';
  const lines = cat.examples.map((e) => {
    const full = e.actions.map((a) => ({
      kind: a.kind,
      fn: a.fn ?? '',
      route: a.route ?? '',
      target: a.target ?? '',
      value: a.value ?? '',
      count: a.count ?? 0,
    }));
    return `Step: ${e.step}\nOutput: ${JSON.stringify({ actions: full })}`;
  });
  return `\n\nExamples:\n${lines.join('\n')}`;
}

export function quotedValues(step: string): string[] {
  return [...step.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? '');
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A value is grounded when the step or the facts contain it (case-insensitive). */
function grounded(value: string, step: string, facts: Record<string, unknown>): boolean {
  if (value === '') return true;
  const v = norm(value);
  return norm(step).includes(v) || norm(JSON.stringify(facts)).includes(v);
}

function closestQuote(value: string, quotes: string[]): string | undefined {
  const v = norm(value);
  let best: string | undefined;
  let bestScore = 0;
  for (const q of quotes) {
    const qn = norm(q);
    const score = qn.includes(v) || v.includes(qn) ? 2 : overlap(v, qn);
    if (score > bestScore) {
      best = q;
      bestScore = score;
    }
  }
  return best;
}

function overlap(a: string, b: string): number {
  const A = new Set(a.split(/\W+/).filter(Boolean));
  const B = new Set(b.split(/\W+/).filter(Boolean));
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.max(1, Math.max(A.size, B.size));
}

/** Guards: ungrounded values snap to the nearest quoted value; Then-steps drop non-assertions. */
export function guardActions(actions: RawAction[], input: PlanInput, cat: Catalog): PlanResult {
  const fixes: string[] = [];
  const quotes = quotedValues(input.step);
  const out: PlannedAction[] = [];
  for (const a of actions) {
    const action: PlannedAction = { kind: a.kind };
    if (input.keyword === 'outcome' && !a.kind.startsWith('expect_')) {
      fixes.push(`dropped ${a.kind} from a Then step`);
      continue;
    }
    if (a.kind === 'call') {
      if (!(a.fn in cat.fns)) {
        fixes.push(`dropped call to unknown fn "${a.fn}"`);
        continue;
      }
      action.fn = a.fn;
    }
    if (a.kind === 'open') {
      if (!(a.route in cat.routes)) {
        fixes.push(`dropped open of unknown route "${a.route}"`);
        continue;
      }
      action.route = a.route;
    }
    if (a.target) action.target = a.target;
    if (a.kind === 'fill' || a.kind.startsWith('expect_')) {
      let value = a.value;
      if (!grounded(value, input.step, input.facts)) {
        const q = closestQuote(value, quotes);
        fixes.push(`value "${value}" not in step/facts -> ${q === undefined ? 'cleared' : `"${q}"`}`);
        value = q ?? '';
      }
      if (value) action.value = value;
      if (a.kind === 'fill' && !value) {
        fixes.push('dropped fill with no grounded value');
        continue;
      }
    }
    if (a.kind === 'expect_count') action.count = a.count;
    // A stray tap/fill after a setup call (F-3); `open` stays: "signed in as" = login call + open route.
    if (input.keyword === 'context' && (a.kind === 'tap' || a.kind === 'fill') && out.some((o) => o.kind === 'call')) {
      fixes.push(`dropped ${a.kind} after a setup call in a Given step`);
      continue;
    }
    out.push(action);
  }
  return { actions: coverQuotes(orderFillsFirst(out, fixes), quotes, fixes), guardFixes: fixes };
}

/**
 * Every quoted value in a step identifies something; a plan that drops one ("tap Delete button" for
 * 'I delete the note "Buy milk"') is ambiguous on any screen with two rows. Attach each unused
 * quote to the first UI action that carries no value.
 */
export function coverQuotes(actions: PlannedAction[], quotes: string[], fixes: string[]): PlannedAction[] {
  if (actions.some((a) => a.kind === 'call')) return actions; // call args are checked separately
  const used = (q: string) =>
    actions.some((a) => [a.value, a.target].some((v) => (v ?? '').toLowerCase().includes(q.toLowerCase())));
  for (const q of quotes) {
    if (!q || used(q)) continue;
    const host = actions.find((a) => (a.kind === 'tap' || a.kind.startsWith('expect_')) && !a.value);
    if (!host) continue;
    host.value = q;
    fixes.push(`attached unused quote "${q}" to ${host.kind}`);
  }
  return actions;
}

/**
 * Small models often emit "tap Submit, fill A, fill B". Within a run of UI actions, typing comes
 * before pressing: fills move ahead of taps (stable), the way every form is used.
 */
export function orderFillsFirst(actions: PlannedAction[], fixes: string[]): PlannedAction[] {
  const firstTap = actions.findIndex((a) => a.kind === 'tap');
  const lastFill = actions.map((a) => a.kind).lastIndexOf('fill');
  if (firstTap === -1 || lastFill === -1 || firstTap > lastFill) return actions;
  const ui = actions.filter((a) => a.kind === 'tap' || a.kind === 'fill');
  const reordered = [...ui.filter((a) => a.kind === 'fill'), ...ui.filter((a) => a.kind === 'tap')];
  let i = 0;
  fixes.push('reordered fills before taps');
  return actions.map((a) => (a.kind === 'tap' || a.kind === 'fill' ? (reordered[i++] as PlannedAction) : a));
}

function argsSchema(fn: Catalog['fns'][string]): JsonSchema {
  const properties: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fn.params)) {
    properties[name] = spec.enum ? { type: spec.type, enum: [...spec.enum] } : { type: spec.type };
  }
  return { type: 'object', properties, required: Object.keys(fn.params) };
}

async function planArgs(
  llm: Llm,
  fnName: string,
  cat: Catalog,
  input: PlanInput,
  fixes: string[],
  occurrence: { index: number; of: number } = { index: 0, of: 1 },
): Promise<Record<string, unknown>> {
  const fn = cat.fns[fnName];
  if (!fn || Object.keys(fn.params).length === 0) return {};
  const params = Object.entries(fn.params)
    .map(([p, s]) => `- ${p} (${s.type}${s.optional ? ', optional: use "" if the step does not say' : ''}): ${s.description}`)
    .join('\n');
  const raw = await llm.json<Record<string, unknown>>({
    system: `You extract the arguments of the function ${fnName} from a Gherkin step. ${fn.description}\nParameters:\n${params}\nCopy values exactly from the step or the facts (without quotes). Never invent values.`,
    prompt:
      `Facts: ${JSON.stringify(input.facts)}\nStep: ${input.step}` +
      (occurrence.of > 1
        ? `\nThis step calls ${fnName} ${occurrence.of} times (once per row/item). Give the arguments for call number ${occurrence.index + 1} (item ${occurrence.index + 1} of ${occurrence.of}).`
        : ''),
    schema: argsSchema(fn),
  });
  const quotes = quotedValues(input.step);
  const args: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(fn.params)) {
    let v = raw[k];
    if (typeof v === 'string') {
      if (v === '' && spec.optional) continue;
      if (!grounded(v, input.step, input.facts) && !spec.enum) {
        const q = closestQuote(v, quotes);
        fixes.push(`${fnName}.${k} "${v}" not in step/facts -> ${q === undefined ? 'kept' : `"${q}"`}`);
        if (q !== undefined) v = q;
      }
    }
    args[k] = v;
  }
  return args;
}

export async function planStep(llm: Llm, cat: Catalog, input: PlanInput): Promise<PlanResult> {
  const system = `${RULES}\n\nApp catalog:\n${describeCatalog(cat)}${exampleBlock(cat)}`;
  const prompt =
    `Facts: ${JSON.stringify(input.facts)}\nStep: ${KEYWORD_LABEL[input.keyword]} ${input.step}` +
    (input.feedback ? `\nA previous plan for this step failed: ${input.feedback}\nGive a corrected plan.` : '') +
    '\nOutput:';
  const ask = async (kinds: readonly ActionKind[]) =>
    (await llm.json<{ actions: RawAction[] }>({ system, prompt, schema: stepSchema(Object.keys(cat.fns), Object.keys(cat.routes), kinds) }))
      .actions ?? [];
  let kinds = kindsFor(input.keyword);
  const navFixes: string[] = [];
  let rawActions = dedupe(await ask(kinds), navFixes);
  // Small models add `open` to steps that never mention a screen ("I sign out" → open). Without a
  // navigation verb, drop it; if nothing is left, ask again with `open` removed from the grammar.
  // Only for When steps: a Given may open a screen to set up state ("signed in as" = API login +
  // open a session route), which no navigation word announces.
  if (input.keyword === 'action' && !NAVIGATION.test(input.step) && rawActions.some((a) => a.kind === 'open')) {
    rawActions = rawActions.filter((a) => a.kind !== 'open');
    navFixes.push('dropped open (no navigation in step)');
    if (rawActions.length === 0) {
      kinds = kinds.filter((k) => k !== 'open');
      rawActions = dedupe(await ask(kinds), navFixes);
      navFixes.push('re-asked without open');
    }
  }
  const result = guardActions(rawActions, input, cat);
  result.guardFixes.unshift(...navFixes);
  if (input.table && input.table.length > 0) return fanOutTable(llm, cat, input, result);
  const totals = new Map<string, number>();
  for (const a of result.actions) if (a.kind === 'call' && a.fn) totals.set(a.fn, (totals.get(a.fn) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const a of result.actions) {
    if (a.kind !== 'call' || !a.fn) continue;
    const index = seen.get(a.fn) ?? 0;
    seen.set(a.fn, index + 1);
    a.args = await planArgs(llm, a.fn, cat, input, result.guardFixes, { index, of: totals.get(a.fn) ?? 1 });
  }
  return result;
}

/**
 * A step with a data table and setup calls: the model plans the call once (which fn, the shared
 * arguments), then one call per row is generated deterministically, matching column headers to
 * parameter names. Small models mis-index rows; code does not.
 */
async function fanOutTable(llm: Llm, cat: Catalog, input: PlanInput, result: PlanResult): Promise<PlanResult> {
  const calls = result.actions.filter((a) => a.kind === 'call' && a.fn);
  const fns = [...new Set(calls.map((a) => a.fn as string))];
  if (fns.length !== 1 || calls.length !== result.actions.length) {
    for (const a of calls) a.args = await planArgs(llm, a.fn as string, cat, input, result.guardFixes);
    return result;
  }
  const fnName = fns[0] as string;
  const fn = cat.fns[fnName];
  const rows = input.table ?? [];
  const firstRow = { ...input, step: input.step.replace(/\s*\[\{.*\}\]\s*$/, '') + ` (first row: ${JSON.stringify(rows[0])})` };
  const shared = await planArgs(llm, fnName, cat, firstRow, result.guardFixes);
  const params = Object.keys(fn?.params ?? {});
  const actions = rows.map((row) => {
    const args: Record<string, unknown> = { ...shared };
    for (const [col, value] of Object.entries(row)) {
      const p = params.find((k) => k.toLowerCase() === col.trim().toLowerCase());
      if (p) args[p] = fn?.params[p]?.type === 'boolean' ? /^(true|yes|y|x|1)$/i.test(value) : fn?.params[p]?.type === 'number' ? Number(value) : value;
    }
    return { kind: 'call' as const, fn: fnName, args };
  });
  if (calls.length !== rows.length) result.guardFixes.push(`table: ${calls.length} planned calls -> ${rows.length} (one per row)`);
  return { actions, guardFixes: result.guardFixes };
}
