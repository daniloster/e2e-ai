// Tokenises the real feature/routine files with the shipped TextMate grammars (vscode-textmate +
// oniguruma, the engine VS Code uses) and checks the scopes that drive the colours.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = join(root, '../..');
const require = createRequire(import.meta.url);

let registry: textmate.Registry;

beforeAll(async () => {
  const wasm = readFileSync(join(dirname(require.resolve('vscode-oniguruma')), 'onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope: string) => {
      const file = { 'source.e2e-feature': 'e2e-feature', 'source.e2e-routine': 'e2e-routine' }[scope];
      if (!file) return null;
      const path = join(root, 'syntaxes', `${file}.tmLanguage.json`);
      return textmate.parseRawGrammar(readFileSync(path, 'utf8'), path);
    },
  });
});

/** [text, scopes] for each token of each line. */
async function tokenize(scope: string, text: string): Promise<[string, string][][]> {
  const grammar = await registry.loadGrammar(scope);
  if (!grammar) throw new Error(`no grammar ${scope}`);
  let state = textmate.INITIAL;
  return text.split('\n').map((line) => {
    const r = grammar.tokenizeLine(line, state);
    state = r.ruleStack;
    return r.tokens.map((t) => [line.slice(t.startIndex, t.endIndex), t.scopes.join(' ')] as [string, string]);
  });
}

const scopeOf = (lines: [string, string][][], text: string) =>
  lines.flat().find(([t]) => t === text)?.[1] ?? `(no token "${text}")`;

describe('feature grammar', () => {
  it('colours hash tags, routine calls, step keywords, strings and tables', async () => {
    const lines = await tokenize('source.e2e-feature', readFileSync(join(repo, 'e2e/features/seeding.feature'), 'utf8'));
    expect(scopeOf(lines, '#seeding')).toContain('entity.name.tag.hash.e2e');
    expect(scopeOf(lines, '#privacy')).toContain('entity.name.tag.hash.e2e');
    expect(scopeOf(lines, 'Background')).toContain('keyword.control.background.e2e');
    expect(scopeOf(lines, '@routine')).toContain('keyword.other.routine.e2e');
    expect(scopeOf(lines, 'bo@example.com')).toContain('string.quoted.double.e2e');
    expect(scopeOf(lines, 'Given')).toContain('keyword.step.given.e2e');
    expect(scopeOf(lines, 'Then')).toContain('keyword.step.then.e2e');
    expect(scopeOf(lines, '|')).toContain('punctuation.separator.table.e2e');
  });

  it('keeps "# text" a comment and "#tag" a tag', async () => {
    const lines = await tokenize('source.e2e-feature', '# just a note\n#smoke #team-atlas\nFeature: X');
    expect(lines[0]?.[0]?.[1]).toContain('comment.line.number-sign.e2e');
    expect(scopeOf(lines, '#smoke')).toContain('entity.name.tag.hash.e2e');
    expect(scopeOf(lines, '#team-atlas')).toContain('entity.name.tag.hash.e2e');
  });
});

describe('globals grammar', () => {
  it('colours @global and its rule text, across continuation lines', async () => {
    const lines = await tokenize('source.e2e-feature', readFileSync(join(repo, 'e2e/features/global.feature'), 'utf8'));
    expect(scopeOf(lines, '@global')).toContain('keyword.control.global.e2e');
    const more = await tokenize('source.e2e-feature', '@global when a "What is new" sheet shows,\n  close it\n# note\n@global stop');
    expect(scopeOf(more, '"What is new"')).toContain('string.quoted.double.e2e');
    expect(scopeOf(more, '  close it')).toContain('string.unquoted.global.e2e');
    expect(scopeOf(more, '# note')).toContain('comment.line.number-sign.e2e');
    expect(more[3]?.[0]?.[1]).toContain('keyword.control.global.e2e');
  });
});

describe('routine grammar', () => {
  it('colours the signature, parameters, table parameters, each and nested calls', async () => {
    const src = ['create_user_with_notes', 'create_notes'].map((f) => readFileSync(join(repo, `e2e/routines/${f}.routine`), 'utf8')).join('\n\n');
    const lines = await tokenize('source.e2e-routine', src);
    expect(scopeOf(lines, 'Routine')).toContain('keyword.control.routine.e2e');
    expect(scopeOf(lines, 'email')).toContain('variable.parameter.e2e');
    expect(scopeOf(lines, 'notes')).toContain('variable.parameter.table.e2e');
    expect(scopeOf(lines, 'title, description')).toContain('variable.other.member.column.e2e');
    expect(scopeOf(lines, 'each')).toContain('keyword.control.loop.each.e2e');
    expect(scopeOf(lines, '@routine')).toContain('keyword.other.routine.e2e');
    expect(scopeOf(lines, 'via API')).toContain('support.constant.channel.e2e');
  });
});
