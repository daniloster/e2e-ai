// `@global` rules: standing statements kept in force for the whole run ("do not allow analytics").
// Shared by the runner and the VS Code extension, so it has no Node or VS Code imports.
//
//   @global do not allow firebase user analytics
//   @global when a "What's new" sheet appears,
//           close it
//
// A rule starts at a line beginning with `@global` and runs to the next `@global` or the end of the
// file; its lines are joined with spaces. Blank lines and `#` comment lines are ignored. A file whose
// first content line starts with `@global` is a globals file (e.g. `features/global.feature`), not
// Gherkin.

export interface GlobalRule {
  /** The statement, its lines joined with single spaces. */
  text: string;
  file: string;
  /** 1-based line of its `@global`. */
  line: number;
  /** 1-based last line of the rule (for editors). */
  endLine: number;
}

export interface GlobalProblem {
  file: string;
  line: number;
  message: string;
}

const GLOBAL_LINE = /^\s*@global\b(.*)$/;
const COMMENT = /^\s*#/;

/** True when the first line with content starts with `@global`. */
export function isGlobalSource(source: string): boolean {
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || COMMENT.test(line)) continue;
    return GLOBAL_LINE.test(line);
  }
  return false;
}

export function parseGlobals(source: string, file = 'global.feature'): { rules: GlobalRule[]; problems: GlobalProblem[] } {
  const rules: GlobalRule[] = [];
  const problems: GlobalProblem[] = [];
  let current: { parts: string[]; line: number; endLine: number } | undefined;
  const close = () => {
    if (!current) return;
    const text = current.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) rules.push({ text, file, line: current.line, endLine: current.endLine });
    else problems.push({ file, line: current.line, message: 'empty @global: write the rule after @global' });
    current = undefined;
  };
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const m = GLOBAL_LINE.exec(raw);
    if (m) {
      close();
      current = { parts: [m[1] ?? ''], line, endLine: line };
      return;
    }
    if (!raw.trim() || COMMENT.test(raw)) return;
    if (!current) {
      problems.push({ file, line, message: 'text before the first @global (a globals file holds only @global rules)' });
      return;
    }
    current.parts.push(raw);
    current.endLine = line;
  });
  close();
  const seen = new Map<string, number>();
  for (const r of rules) {
    const key = r.text.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) problems.push({ file, line: r.line, message: `duplicate @global (same rule as line ${first})` });
    else seen.set(key, r.line);
  }
  return { rules, problems };
}
