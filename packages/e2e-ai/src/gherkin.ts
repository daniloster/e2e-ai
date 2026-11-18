// Feature files → executable scenarios. The dialect (dialect.ts: `#tags`, `@routine` lines,
// several Backgrounds) is translated to standard Gherkin, then the official Cucumber parser and
// pickle compiler do the rest (Background, Scenario Outline/Examples, Rules, tables, doc strings).
// Line numbers are mapped back to the file the author wrote.
import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument, type PickleStep } from '@cucumber/messages';

import { hashTag, preprocessFeature } from './dialect.ts';
import type { Origin } from './routines.ts';

export type StepKeyword = 'context' | 'action' | 'outcome' | 'unknown';

export interface ScenarioStep {
  keyword: StepKeyword;
  /** Step text with any data table / doc string appended in a compact form. */
  text: string;
  /** A data table with a header row, as one object per body row. */
  table?: Record<string, string>[];
  /** 1-based line in the feature file (for routine steps: the line of the `@routine` call). */
  line?: number;
  /** Set on steps that came from routines: the call chain, outermost first. */
  origin?: Origin[];
  /** Routine parameters in effect (plan cache key + planner facts). */
  scope?: Record<string, string>;
  /** True for steps that come from a `Background:` (including steps expanded from its routines). */
  background?: boolean;
  /** Set when a `@routine` call could not be expanded; the runner fails this step with it. */
  error?: string;
}

export interface Scenario {
  feature: string;
  name: string;
  /** Tags written as `#tag` (feature tags included, as Cucumber inherits them). */
  tags: string[];
  featureTags: string[];
  /** The Background group (`Background 2`) or Rule the scenario belongs to, if any. */
  rule?: string;
  uri: string;
  line?: number;
  steps: ScenarioStep[];
}

function stepText(s: PickleStep): string {
  const arg = s.argument;
  if (arg?.dataTable) {
    const rows = arg.dataTable.rows.map((r) => r.cells.map((c) => c.value));
    const [header, ...body] = rows;
    if (header && body.length > 0) {
      const objs = body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
      return `${s.text} ${JSON.stringify(objs)}`;
    }
    return `${s.text} ${JSON.stringify(rows)}`;
  }
  if (arg?.docString) return `${s.text} """${arg.docString.content}"""`;
  return s.text;
}

const KEYWORD: Record<string, StepKeyword> = { Context: 'context', Action: 'action', Outcome: 'outcome' };

/** AST node id → { line, rule } for every step and scenario in the document. */
function locate(doc: GherkinDocument): Map<string, { line: number; rule?: string; example?: string; background?: boolean }> {
  const map = new Map<string, { line: number; rule?: string; example?: string; background?: boolean }>();
  const steps = (list: readonly { id: string; location: { line: number } }[], rule?: string, background = false) => {
    for (const s of list) {
      const loc: { line: number; rule?: string; background?: boolean } = { line: s.location.line };
      if (rule !== undefined) loc.rule = rule;
      if (background) loc.background = true;
      map.set(s.id, loc);
    }
  };
  const children = (kids: GherkinDocument['feature'] extends infer F ? (F extends { children: infer C } ? C : never) : never, rule?: string) => {
    for (const c of kids as readonly Record<string, unknown>[]) {
      const bg = c.background as { steps: { id: string; location: { line: number } }[] } | undefined;
      const sc = c.scenario as
        | { id: string; location: { line: number }; steps: { id: string; location: { line: number } }[]; examples: { tableBody: { id: string; location: { line: number } }[] }[] }
        | undefined;
      const r = c.rule as { name: string; children: unknown } | undefined;
      if (bg) steps(bg.steps, rule, true);
      if (sc) {
        map.set(sc.id, rule === undefined ? { line: sc.location.line } : { line: sc.location.line, rule });
        steps(sc.steps, rule);
        for (const ex of sc.examples as unknown as { tableHeader?: { cells: { value: string }[] }; tableBody: { id: string; location: { line: number }; cells: { value: string }[] }[] }[]) {
          const head = ex.tableHeader?.cells.map((c) => c.value) ?? [];
          for (const row of ex.tableBody) {
            const label = row.cells.map((c, i) => `${head[i] ?? i}: ${c.value}`).join(', ');
            map.set(row.id, rule === undefined ? { line: row.location.line, example: label } : { line: row.location.line, rule, example: label });
          }
        }
      }
      if (r) children(r.children as never, r.name);
    }
  };
  if (doc.feature) children(doc.feature.children as never);
  return map;
}

export function parseFeature(source: string, uri = 'inline.feature'): Scenario[] {
  const { gherkin, lineMap } = preprocessFeature(source);
  const orig = (line: number) => lineMap[line - 1] ?? line;
  const newId = IdGenerator.uuid();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  const doc = parser.parse(gherkin);
  const feature = doc.feature?.name ?? uri;
  const featureTags = (doc.feature?.tags ?? []).map((t) => hashTag(t.name));
  const where = locate(doc);
  return compile(doc, uri, newId).map((p) => {
    // A pickle's astNodeIds: [scenario, examples row?]; the row's line identifies an Outline example.
    const scLoc = where.get(p.astNodeIds[p.astNodeIds.length - 1] as string) ?? where.get(p.astNodeIds[0] as string);
    let previous: StepKeyword = 'context';
    const scenario: Scenario = {
      feature,
      // Outline rows share a name; the example values tell them apart in logs and reports.
      name: scLoc?.example ? `${p.name} — ${scLoc.example}` : p.name,
      tags: p.tags.map((t) => hashTag(t.name)),
      featureTags,
      uri,
      steps: p.steps.map((s) => {
        let keyword = KEYWORD[s.type ?? ''] ?? 'unknown';
        if (keyword === 'unknown') keyword = previous; // `*` steps (and `@routine` lines) inherit
        previous = keyword;
        const step: ScenarioStep = { keyword, text: stepText(s) };
        const loc = where.get(s.astNodeIds[0] as string);
        if (loc) step.line = orig(loc.line);
        if (loc?.background) step.background = true;
        const rows = s.argument?.dataTable?.rows.map((r) => r.cells.map((c) => c.value));
        if (rows && rows.length > 1) {
          const [header, ...body] = rows as [string[], ...string[][]];
          step.table = body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
        }
        return step;
      }),
    };
    if (scLoc) scenario.line = orig(scLoc.line);
    if (scLoc?.rule) scenario.rule = scLoc.rule;
    return scenario;
  });
}

/** The text after `@routine` when a step is a routine call, else undefined. */
export function routineCall(step: ScenarioStep): string | undefined {
  const m = /^@routine\b\s*(.*)$/s.exec(step.text);
  if (!m) return undefined;
  // Drop the compact table JSON stepText appended; the table travels in step.table.
  return (m[1] ?? '').replace(/\s*\[\{.*\}\]\s*$/s, '').replace(/\s*\[\[.*\]\]\s*$/s, '').trim();
}
