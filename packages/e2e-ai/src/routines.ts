// Loads `.routine` files and expands `@routine` calls into concrete steps before planning.
// Matching is deterministic (routineSyntax.matchRoutine); only when no signature matches does the
// pocket model pick one — from an enum of signatures, with "none" allowed — and every argument it
// binds must literally appear in the call, so a fuzzy match can never invent data.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Llm } from './llm.ts';
import {
  matchRoutine,
  parseRoutineFile,
  substitute,
  type RoutineDef,
  type RoutineMatch,
  type RoutineNode,
  type StepKeyword,
  type TableRow,
} from './routineSyntax.ts';

export interface Origin {
  routine: string; // signature
  file: string;
  line: number; // line of the body node inside the routine file
  call: string; // the call text as written by the caller (after substitution)
  via: 'exact' | 'model';
}

export interface ExpandedStep {
  keyword: StepKeyword;
  text: string;
  table?: TableRow[];
  origin: Origin[];
  /** Routine parameters in effect: part of the plan cache key and shown to the planner. */
  scope: Record<string, string>;
}

export interface RoutineLibrary {
  defs: RoutineDef[];
  diagnostics: { file: string; line: number; message: string }[];
}

export class RoutineError extends Error {}

export function loadRoutines(dir: string, root = process.cwd()): RoutineLibrary {
  const defs: RoutineDef[] = [];
  const visit = (d: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) visit(p);
      else if (n.endsWith('.routine')) defs.push(...parseRoutineFile(readFileSync(p, 'utf8'), relative(root, p)));
    }
  };
  visit(dir);
  const diagnostics = defs.flatMap((d) => d.diagnostics.map((x) => ({ file: d.file, ...x })));
  const seen = new Map<string, RoutineDef>();
  for (const d of defs) {
    const key = d.signature.toLowerCase();
    const prev = seen.get(key);
    if (prev) diagnostics.push({ file: d.file, line: d.line, message: `Duplicate routine (also ${prev.file}:${prev.line})` });
    seen.set(key, d);
  }
  return { defs, diagnostics };
}

async function modelMatch(callText: string, lib: RoutineLibrary, llm: Llm): Promise<RoutineMatch | undefined> {
  if (lib.defs.length === 0) return undefined;
  const choices = lib.defs.map((_, i) => String(i));
  const pick = await llm.json<{ choice: string }>({
    system:
      'A test step calls a reusable routine by a sentence. Pick the routine whose signature means the same thing, or "none". ${...} are parameters.',
    prompt: `Call: ${callText}\nRoutines:\n${lib.defs.map((d, i) => `${i}: ${d.signature}`).join('\n')}`,
    schema: { type: 'object', properties: { choice: { type: 'string', enum: [...choices, 'none'] } }, required: ['choice'] },
  });
  const def = pick.choice === 'none' ? undefined : lib.defs[Number(pick.choice)];
  if (!def) return undefined;
  const values = def.params.filter((p) => p.kind === 'value').map((p) => p.name);
  if (values.length === 0) return { def, args: {} };
  const raw = await llm.json<Record<string, string>>({
    system: `Extract the parameters of the routine "${def.signature}" from the call. Copy each value exactly from the call, without quotes.`,
    prompt: `Call: ${callText}`,
    schema: {
      type: 'object',
      properties: Object.fromEntries(values.map((v) => [v, { type: 'string' }])),
      required: values,
    },
  });
  const args: Record<string, string> = {};
  for (const v of values) {
    const val = String(raw[v] ?? '');
    if (!val || !callText.toLowerCase().includes(val.toLowerCase())) return undefined; // never invent data
    args[v] = val;
  }
  return { def, args };
}

export interface ExpandOptions {
  lib: RoutineLibrary;
  llm?: Llm;
  maxDepth?: number;
}

/** Expands one `@routine` call (text after `@routine`) into concrete steps, recursively. */
export async function expandCall(
  callText: string,
  table: TableRow[] | undefined,
  keyword: StepKeyword,
  opts: ExpandOptions,
  origin: Origin[] = [],
): Promise<ExpandedStep[]> {
  if (origin.length > (opts.maxDepth ?? 8)) throw new RoutineError(`routine nesting deeper than ${opts.maxDepth ?? 8}: ${callText}`);
  let match = matchRoutine(callText, opts.lib.defs);
  let via: Origin['via'] = 'exact';
  if (!match && opts.llm) {
    match = await modelMatch(callText, opts.lib, opts.llm);
    via = 'model';
  }
  if (!match) throw new RoutineError(`no routine matches "@routine ${callText.trim()}"`);
  const { def, args } = match;
  if (origin.some((o) => o.routine === def.signature)) throw new RoutineError(`routine calls itself: ${def.signature}`);

  const tables: Record<string, TableRow[]> = {};
  const tableParams = def.params.filter((p) => p.kind === 'table');
  if (tableParams.length > 0) {
    const first = tableParams[0] as { name: string; columns?: string[] };
    if (!table) throw new RoutineError(`routine "${def.signature}" needs a data table (${first.name})`);
    const missing = (first.columns ?? []).filter((c) => !table.some((r) => c in r));
    if (missing.length) throw new RoutineError(`table for "${first.name}" lacks column(s): ${missing.join(', ')}`);
    tables[first.name] = table;
  }

  const out: ExpandedStep[] = [];
  const visit = async (nodes: RoutineNode[], scope: Record<string, string>) => {
    for (const node of nodes) {
      const here: Origin = { routine: def.signature, file: def.file, line: node.line, call: callText.trim(), via };
      if (node.kind === 'each') {
        for (const row of tables[node.text] ?? []) await visit(node.body ?? [], { ...scope, ...row });
        continue;
      }
      const sub = substitute(node.text, scope);
      if (sub.missing.length) throw new RoutineError(`${def.file}:${node.line} unknown \${${sub.missing.join('}, ${')}}`);
      const rows =
        node.table?.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, substitute(v, scope).text]))) ??
        (sub.tables[0] ? tables[sub.tables[0]] : undefined);
      const kw = node.keyword ?? keyword;
      if (node.kind === 'call') {
        out.push(...(await expandCall(sub.text, rows, kw, opts, [...origin, here])));
      } else {
        const step: ExpandedStep = { keyword: kw, text: sub.text, origin: [...origin, here], scope: { ...scope } };
        if (rows) step.table = rows;
        out.push(step);
      }
    }
  };
  await visit(def.body, { ...args });
  return out;
}
