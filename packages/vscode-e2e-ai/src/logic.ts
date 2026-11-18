// Editor logic without the VS Code API (unit-tested): what to complete, what a line calls, and
// what is wrong in a document. Routine parsing/matching is the runner's own (routineSyntax.ts), so
// the editor and the runner always agree on which routine a call means.
import {
  matchRoutine,
  parseRoutineFile,
  toSnippet,
  type RoutineDef,
} from '../../e2e-ai/src/routineSyntax.ts';
import { isGlobalSource, parseGlobals, type GlobalRule } from '../../e2e-ai/src/globalSyntax.ts';

export { matchRoutine, parseRoutineFile, toSnippet, type RoutineDef };
export { isGlobalSource, parseGlobals, type GlobalRule };

export const GLOBAL_LINE = /^\s*@global\b/;

export const CALL_LINE = /^(\s*)((?:Given|When|Then|And|But|\*)\s+)?@routine\b\s*(.*)$/;

export type CompletionContext =
  | { kind: 'routine-keyword'; start: number; indent: string; bare: boolean } // typing "@ro…" (bare: no step keyword)
  | { kind: 'routine-call'; start: number; typed: string; indent: string } // after "@routine "
  | { kind: 'tag'; start: number; typed: string } // "#te…" on a tag line
  | { kind: 'variable'; start: number }; // "${" inside a routine

export function completionContext(linePrefix: string, language: 'e2e-feature' | 'e2e-routine'): CompletionContext | undefined {
  const call = /^(\s*)((?:Given|When|Then|And|But|\*)\s+)?@routine\s+(.*)$/.exec(linePrefix);
  if (call) {
    const start = linePrefix.length - (call[3] ?? '').length;
    return { kind: 'routine-call', start, typed: call[3] ?? '', indent: call[1] ?? '' };
  }
  const kw = /^(\s*)((?:Given|When|Then|And|But|\*)\s+)?(@\w*)$/.exec(linePrefix);
  if (kw) return { kind: 'routine-keyword', start: linePrefix.length - (kw[3] ?? '').length, indent: kw[1] ?? '', bare: !kw[2] };
  if (language === 'e2e-routine') {
    const v = /\$\{[\w:-]*$/.exec(linePrefix);
    if (v) return { kind: 'variable', start: v.index };
  }
  const tag = /^\s*(?:#[\w-]+\s+)*(#[\w-]*)$/.exec(linePrefix);
  if (tag) return { kind: 'tag', start: linePrefix.length - (tag[1] ?? '').length, typed: tag[1] ?? '' };
  return undefined;
}

/** The routine that encloses `line` (0-based) in a routine document. */
export function routineAt(defs: RoutineDef[], line: number): RoutineDef | undefined {
  let found: RoutineDef | undefined;
  for (const d of defs) if (d.line - 1 <= line) found = d;
  return found;
}

export interface Problem {
  line: number; // 0-based
  start: number;
  end: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

/** Feature (or routine body) problems: unknown routine calls and missing data tables. */
export function callProblems(text: string, defs: RoutineDef[]): Problem[] {
  const lines = text.split(/\r?\n/);
  const out: Problem[] = [];
  lines.forEach((l, i) => {
    const m = CALL_LINE.exec(l);
    if (!m) return;
    const call = m[3] ?? '';
    const start = l.indexOf('@routine');
    if (!call.trim()) {
      out.push({ line: i, start, end: l.length, message: 'Name the routine to call after @routine', severity: 'error' });
      return;
    }
    // In routine bodies a call may pass the caller's table: `... ${table:notes[...]}`.
    const match = matchRoutine(call, defs);
    if (!match) {
      out.push({
        line: i,
        start,
        end: l.length,
        message: 'No routine matches this call. The runner will ask the pocket model for the closest routine; add or fix a .routine file to make it deterministic.',
        severity: 'warning',
      });
      return;
    }
    const needsTable = match.def.params.some((p) => p.kind === 'table');
    const next = lines.slice(i + 1).find((x) => x.trim() !== '');
    const passesTable = /\$\{table:/.test(call);
    if (needsTable && !passesTable && !(next ?? '').trim().startsWith('|')) {
      const cols = match.def.params.find((p) => p.kind === 'table')?.columns ?? [];
      out.push({ line: i, start, end: l.length, message: `This routine needs a data table below the call (| ${cols.join(' | ')} |)`, severity: 'error' });
    }
  });
  return out;
}

/**
 * `@global` problems, from the runner's own parser: empty, stray and duplicate rules in a globals file,
 * and an `@global` line inside a Gherkin feature (the runner only reads rules from globals files —
 * files whose first content line is `@global`).
 */
export function globalProblems(text: string): Problem[] {
  if (isGlobalSource(text)) {
    return parseGlobals(text).problems.map((p) => ({ line: p.line - 1, start: 0, end: 400, message: p.message, severity: p.message.startsWith('duplicate') ? 'warning' : 'error' }));
  }
  const out: Problem[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (GLOBAL_LINE.test(l)) {
      out.push({
        line: i,
        start: l.indexOf('@global'),
        end: l.length,
        message: '@global rules go in their own file (e.g. features/global.feature, first line @global); inside a feature the runner ignores them',
        severity: 'warning',
      });
    }
  });
  return out;
}

/** Problems inside .routine files (from the shared parser) plus duplicate signatures. */
export function routineProblems(defs: RoutineDef[], all: RoutineDef[]): Problem[] {
  const out: Problem[] = [];
  for (const d of defs) {
    for (const x of d.diagnostics) out.push({ line: x.line - 1, start: 0, end: 400, message: x.message, severity: 'error' });
    // Same file + same line is this routine (the open document is parsed again, so identity differs).
    const dup = all.find(
      (o) => !(o.file === d.file && o.line === d.line) && o.signature.toLowerCase() === d.signature.toLowerCase(),
    );
    if (dup) out.push({ line: d.line - 1, start: 0, end: 400, message: `Duplicate routine: also in ${dup.file}:${dup.line}`, severity: 'error' });
  }
  return out;
}

/** Readable label for a signature in completion lists: `create user "‹email›" … notes: ‹table›`. */
export function label(def: RoutineDef): string {
  return def.signature
    .replace(/\$\{table:([\w-]+)(?:\[[^\]]*\])?\}/g, '‹table $1›')
    .replace(/\$\{([\w-]+)\}/g, '‹$1›');
}
