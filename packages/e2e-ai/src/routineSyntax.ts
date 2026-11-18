// `.routine` files: reusable, human-language step groups (prepare data, or a UI flow) that features
// call with `@routine <signature>`. Pure (no Node/VS Code imports): shared by the runner and the
// VS Code extension, so both match a call to a routine the same way.
//
//   Routine: create user "${email}" with password "${password}" and notes: ${table:notes[title, description]}
//
//   @routine create user with login "${email}" and password "${password}"
//   each ${table:notes}
//     create a note with title "${title}" and description "${description}" via API
//
// - `${name}` is a value parameter; `${table:name[col, ...]}` a data-table parameter (the caller's
//   table). A file may hold several `Routine:` blocks.
// - Body lines are steps (optionally starting with Given/When/Then/And/But), nested `@routine`
//   calls, or `each ${table:x}` loops over the indented lines below (or the next line).
// - `# comment` lines and blank lines are ignored.

export type StepKeyword = 'context' | 'action' | 'outcome';

export interface RoutineParam {
  name: string;
  kind: 'value' | 'table';
  columns?: string[];
}

export interface TableRow {
  [column: string]: string;
}

export interface RoutineNode {
  kind: 'step' | 'call' | 'each';
  /** Text without the keyword / `@routine` prefix; for `each`, the table name. */
  text: string;
  keyword?: StepKeyword;
  line: number; // 1-based
  table?: TableRow[]; // an inline data table under a step or call
  body?: RoutineNode[]; // each
}

export interface RoutineDef {
  file: string;
  signature: string;
  line: number; // 1-based line of `Routine:`
  params: RoutineParam[];
  body: RoutineNode[];
  diagnostics: { line: number; message: string }[];
}

export interface RoutineMatch {
  def: RoutineDef;
  args: Record<string, string>;
}

const VAR = /\$\{(table:)?([A-Za-z_][\w-]*)(?:\[([^\]]*)\])?\}/g;
const STEP_KEYWORD = /^(Given|When|Then|And|But|\*)\s+/;
const KEYWORD_OF: Record<string, StepKeyword | undefined> = { Given: 'context', When: 'action', Then: 'outcome' };

export function signatureParams(signature: string): RoutineParam[] {
  const out: RoutineParam[] = [];
  for (const m of signature.matchAll(VAR)) {
    const name = m[2] as string;
    if (out.some((p) => p.name === name)) continue;
    if (m[1]) {
      const columns = (m[3] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
      out.push({ name, kind: 'table', columns });
    } else out.push({ name, kind: 'value' });
  }
  return out;
}

function parseTableLine(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Rows `| a | b |` (first row is the header) → objects. */
export function rowsToObjects(rows: string[][]): TableRow[] {
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const indentOf = (s: string) => s.length - s.trimStart().length;

export function parseRoutineFile(text: string, file = 'inline.routine'): RoutineDef[] {
  const lines = text.split(/\r?\n/);
  const defs: RoutineDef[] = [];
  let current: RoutineDef | undefined;
  // Flat list of (indent, node) for the current routine; folded into `each` blocks at the end.
  let flat: { indent: number; node: RoutineNode }[] = [];

  const finish = () => {
    if (!current) return;
    current.body = foldEach(flat, current);
    checkVars(current);
    defs.push(current);
    flat = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const t = raw.trim();
    const lineNo = i + 1;
    if (t === '' || /^#(\s|$)/.test(t)) continue;
    const header = /^Routine:\s*(.*)$/.exec(t);
    if (header) {
      finish();
      const signature = (header[1] ?? '').trim();
      current = { file, signature, line: lineNo, params: signatureParams(signature), body: [], diagnostics: [] };
      if (!signature) current.diagnostics.push({ line: lineNo, message: 'Routine without a signature' });
      continue;
    }
    if (!current) continue; // text before the first Routine: is ignored
    if (t.startsWith('|')) {
      const last = flat[flat.length - 1];
      if (!last || last.node.kind === 'each') {
        current.diagnostics.push({ line: lineNo, message: 'Table row without a step or call above it' });
        continue;
      }
      const rows = (last.node as RoutineNode & { _rows?: string[][] })._rows ?? [];
      rows.push(parseTableLine(t));
      (last.node as RoutineNode & { _rows?: string[][] })._rows = rows;
      last.node.table = rowsToObjects(rows);
      continue;
    }
    let body = t;
    let keyword: StepKeyword | undefined;
    const kw = STEP_KEYWORD.exec(body);
    if (kw) {
      keyword = KEYWORD_OF[kw[1] as string];
      body = body.slice(kw[0].length);
    }
    const each = /^each\s+\$\{(?:table:)?([A-Za-z_][\w-]*)(?:\[[^\]]*\])?\}\s*:?\s*$/i.exec(body);
    let node: RoutineNode;
    if (each) node = { kind: 'each', text: each[1] as string, line: lineNo, body: [] };
    else if (/^@routine\b/.test(body)) node = { kind: 'call', text: body.replace(/^@routine\s*/, ''), line: lineNo };
    else node = { kind: 'step', text: body, line: lineNo };
    if (keyword) node.keyword = keyword;
    flat.push({ indent: indentOf(raw), node });
  }
  finish();
  for (const d of defs) for (const n of walk(d.body)) delete (n as RoutineNode & { _rows?: unknown })._rows;
  return defs;
}

function* walk(nodes: RoutineNode[]): Generator<RoutineNode> {
  for (const n of nodes) {
    yield n;
    if (n.body) yield* walk(n.body);
  }
}

/** `each` takes the following lines indented deeper than itself, or else just the next line. */
function foldEach(flat: { indent: number; node: RoutineNode }[], def: RoutineDef): RoutineNode[] {
  const out: RoutineNode[] = [];
  for (let i = 0; i < flat.length; i++) {
    const { indent, node } = flat[i] as { indent: number; node: RoutineNode };
    if (node.kind !== 'each') {
      out.push(node);
      continue;
    }
    const block: { indent: number; node: RoutineNode }[] = [];
    let j = i + 1;
    while (j < flat.length && (flat[j] as { indent: number }).indent > indent) block.push(flat[j++] as never);
    if (block.length === 0 && j < flat.length) block.push(flat[j++] as never);
    if (block.length === 0) def.diagnostics.push({ line: node.line, message: '`each` has no step below it' });
    node.body = foldEach(block, def);
    out.push(node);
    i = j - 1;
  }
  return out;
}

/** Variables used in the body must be parameters or columns of a table being iterated. */
function checkVars(def: RoutineDef): void {
  const values = new Set(def.params.filter((p) => p.kind === 'value').map((p) => p.name));
  const tables = new Map(def.params.filter((p) => p.kind === 'table').map((p) => [p.name, p.columns ?? []]));
  const visit = (nodes: RoutineNode[], scope: Set<string>) => {
    for (const n of nodes) {
      if (n.kind === 'each') {
        if (!tables.has(n.text)) def.diagnostics.push({ line: n.line, message: `\`each\` over unknown table "${n.text}"` });
        const cols = tables.get(n.text) ?? [];
        visit(n.body ?? [], new Set([...scope, ...cols]));
        continue;
      }
      for (const m of n.text.matchAll(VAR)) {
        const name = m[2] as string;
        if (m[1] ? !tables.has(name) : !scope.has(name)) {
          def.diagnostics.push({ line: n.line, message: `Unknown ${m[1] ? 'table' : 'variable'} \${${m[1] ?? ''}${name}}` });
        }
      }
    }
  };
  visit(def.body, values);
}

// ---------------------------------------------------------------- matching a call

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripColon = (s: string) => s.trim().replace(/\s*:\s*$/, '').trim();

/** The signature with table placeholders removed: what a call's text must look like. */
export function callShape(signature: string): string {
  return stripColon(signature.replace(VAR, (m, table: string | undefined) => (table ? '' : m)).replace(/\s+/g, ' '));
}

export function signatureRegex(signature: string): { re: RegExp; names: string[] } {
  const shape = callShape(signature);
  const names: string[] = [];
  let src = '';
  let last = 0;
  for (const m of shape.matchAll(VAR)) {
    src += escapeRe(shape.slice(last, m.index)).replace(/\s+/g, '\\s+');
    src += '(.+?)';
    names.push(m[2] as string);
    last = (m.index ?? 0) + m[0].length;
  }
  src += escapeRe(shape.slice(last)).replace(/\s+/g, '\\s+');
  return { re: new RegExp(`^${src}$`, 'i'), names };
}

/** Deterministic match of a call (text after `@routine`) against the library; most literal text wins. */
export function matchRoutine(callText: string, defs: readonly RoutineDef[]): RoutineMatch | undefined {
  // A call in a routine body may pass a table on (`… notes: ${table:notes[title, description]}`);
  // tables travel separately, so the placeholder is not part of the text to match.
  const text = stripColon(callText.replace(/\$\{table:[^}]*\}/g, ' ').replace(/\s+/g, ' '));
  let best: (RoutineMatch & { literal: number }) | undefined;
  for (const def of defs) {
    const { re, names } = signatureRegex(def.signature);
    const m = re.exec(text);
    if (!m) continue;
    const args: Record<string, string> = {};
    names.forEach((n, i) => (args[n] = m[i + 1] ?? ''));
    const literal = callShape(def.signature).replace(VAR, '').length;
    if (!best || literal > best.literal) best = { def, args, literal };
  }
  return best ? { def: best.def, args: best.args } : undefined;
}

/** Replaces `${name}` from scope; `${table:x[...]}` placeholders are removed (tables travel separately). */
export function substitute(text: string, scope: Record<string, string>): { text: string; tables: string[]; missing: string[] } {
  const tables: string[] = [];
  const missing: string[] = [];
  const out = text.replace(VAR, (m, table: string | undefined, name: string) => {
    if (table) {
      tables.push(name);
      return '';
    }
    if (name in scope) return scope[name] as string;
    missing.push(name);
    return m;
  });
  return { text: out.replace(/\s+/g, ' ').trim(), tables, missing };
}

/** A VS Code snippet for a call: `create user "${1:email}" ... and notes:` + a table skeleton. */
export function toSnippet(def: RoutineDef, indent = ''): string {
  let n = 0;
  const esc = (s: string) => s.replace(/[$}\\]/g, '\\$&');
  let shape = '';
  let last = 0;
  const sig = def.signature;
  const tableParams: RoutineParam[] = [];
  for (const m of sig.matchAll(VAR)) {
    shape += esc(sig.slice(last, m.index));
    if (m[1]) tableParams.push(def.params.find((p) => p.name === m[2]) as RoutineParam);
    else shape += `\${${++n}:${m[2]}}`;
    last = (m.index ?? 0) + m[0].length;
  }
  shape += esc(sig.slice(last));
  shape = shape.replace(/\s+$/, '');
  for (const t of tableParams) {
    const cols = t.columns?.length ? t.columns : ['value'];
    shape += `\n${indent}  | ${cols.join(' | ')} |\n${indent}  | ${cols.map((c) => `\${${++n}:${c}}`).join(' | ')} |`;
  }
  return shape;
}
