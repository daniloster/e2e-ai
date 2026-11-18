// The feature dialect on top of Gherkin, translated to standard Gherkin before the official parser
// runs (and a line map back, so reports and editors point at the lines the author wrote):
// - `#notes #team-atlas` on a line of its own are tags (a comment is `# text`, with a space);
// - `@routine <call>` lines are steps (a `*` step), optionally after a step keyword;
// - several `Background:` blocks in one feature: each applies to the scenarios below it, until the
//   next one (translated to one `Rule:` per Background).

export interface Preprocessed {
  gherkin: string;
  /** lineMap[i] = 1-based line in the original file for line i+1 of `gherkin`. */
  lineMap: number[];
}

export const HASH_TAG_LINE = /^\s*#[A-Za-z0-9_][\w-]*(\s+#[A-Za-z0-9_][\w-]*)*\s*$/;
const ROUTINE_LINE = /^(\s*)((?:Given|When|Then|And|But|\*)\s+)?@routine\b(.*)$/;
const BACKGROUND = /^(\s*)Background:(.*)$/;

export function preprocessFeature(source: string): Preprocessed {
  const lines = source.split(/\r?\n/);
  const backgrounds = lines.filter((l) => BACKGROUND.test(l)).length;
  const hasRule = lines.some((l) => /^\s*Rule:/.test(l));
  const wrapInRules = backgrounds > 1 && !hasRule;
  const out: string[] = [];
  const lineMap: number[] = [];
  let group = 0;
  lines.forEach((line, i) => {
    let l = line;
    if (HASH_TAG_LINE.test(l) && !/^\s*#\s*language\s*:/.test(l)) l = l.replace(/#(?=[A-Za-z0-9_])/g, '@');
    const r = ROUTINE_LINE.exec(l);
    if (r) l = `${r[1]}${r[2] ?? '* '}@routine${r[3]}`;
    const bg = BACKGROUND.exec(l);
    if (bg && wrapInRules) {
      group++;
      out.push(`${bg[1]}Rule: Background ${group}`);
      lineMap.push(i + 1);
    }
    out.push(l);
    lineMap.push(i + 1);
  });
  return { gherkin: out.join('\n'), lineMap };
}

/** `@x` (Gherkin) → `#x` (how this dialect writes tags). */
export const hashTag = (t: string) => (t.startsWith('@') ? `#${t.slice(1)}` : t);

/** Tag filter: `#a,#b` = any of; `!#c` = none of. Empty = everything. */
export function matchesTags(tags: readonly string[], expr: string | undefined): boolean {
  if (!expr) return true;
  const parts = expr.split(',').map((s) => s.trim()).filter(Boolean);
  const norm = (t: string) => hashTag(t.replace(/^!/, '')).toLowerCase();
  const have = new Set(tags.map((t) => hashTag(t).toLowerCase()));
  const include = parts.filter((p) => !p.startsWith('!')).map(norm);
  const exclude = parts.filter((p) => p.startsWith('!')).map(norm);
  return (include.length === 0 || include.some((t) => have.has(t))) && !exclude.some((t) => have.has(t));
}
