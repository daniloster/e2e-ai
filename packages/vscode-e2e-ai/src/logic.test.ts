import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { callProblems, completionContext, globalProblems, label, parseRoutineFile, routineAt, routineProblems, toSnippet } from './logic.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const defs = ['create_user', 'create_notes', 'create_user_with_notes'].flatMap((f) =>
  parseRoutineFile(readFileSync(join(repo, `e2e/routines/${f}.routine`), 'utf8'), `${f}.routine`),
);

describe('completion context', () => {
  it('offers routines after "@" and after "@routine "', () => {
    expect(completionContext('    @', 'e2e-feature')).toMatchObject({ kind: 'routine-keyword', start: 4, bare: true });
    expect(completionContext('@gl', 'e2e-feature')).toMatchObject({ kind: 'routine-keyword', start: 0, bare: true });
    expect(completionContext('    Given @rou', 'e2e-feature')).toMatchObject({ kind: 'routine-keyword', start: 10 });
    expect(completionContext('    @routine create us', 'e2e-feature')).toMatchObject({ kind: 'routine-call', start: 13, typed: 'create us' });
  });
  it('offers tags on tag lines and variables inside routines', () => {
    expect(completionContext('  #smoke #te', 'e2e-feature')).toMatchObject({ kind: 'tag', typed: '#te' });
    expect(completionContext('create a note "${ti', 'e2e-routine')).toMatchObject({ kind: 'variable', start: 15 });
    expect(completionContext('    When I add a note', 'e2e-feature')).toBeUndefined();
  });
});

describe('snippets and labels', () => {
  it('turns a signature with a table into tab stops plus a table skeleton', () => {
    const def = defs.find((d) => d.signature.startsWith('create user "'));
    expect(def && toSnippet(def, '    ')).toBe(
      'create user "${1:email}" with password "${2:password}" and notes:\n      | title | description |\n      | ${3:title} | ${4:description} |',
    );
    expect(def && label(def)).toBe('create user "‹email›" with password "‹password›" and notes: ‹table notes›');
  });
});

describe('diagnostics', () => {
  it('accepts the seeding feature as written', () => {
    expect(callProblems(readFileSync(join(repo, 'e2e/features/seeding.feature'), 'utf8'), defs)).toEqual([]);
  });
  it('accepts calls inside routine bodies that pass a table on (create_user_with_notes.routine)', () => {
    const text = readFileSync(join(repo, 'e2e/routines/create_user_with_notes.routine'), 'utf8');
    expect(callProblems(text, defs)).toEqual([]);
  });
  it('flags unknown routines and a missing table', () => {
    const text = '  Background:\n    @routine archive everything\n    @routine create user "a@b.c" with password "x" and notes:\n  Scenario: S';
    const problems = callProblems(text, defs);
    expect(problems.map((p) => [p.line, p.severity])).toEqual([
      [1, 'warning'],
      [2, 'error'],
    ]);
  });
  it('reports unknown variables and tables inside routines, and duplicates', () => {
    const bad = parseRoutineFile('Routine: do "${a}"\n\neach ${table:rows}\n  type "${b}"\n', 'bad.routine');
    const msgs = routineProblems(bad, [...defs, ...bad]).map((p) => p.message);
    expect(msgs).toContain('`each` over unknown table "rows"');
    const dup = parseRoutineFile('Routine: create user with login "${email}" and password "${password}"\n\nx', 'dup.routine');
    expect(routineProblems(dup, [...defs, ...dup])[0]?.message).toMatch(/Duplicate routine/);
  });
  it('does not flag a routine as a duplicate of its own re-parsed copy', () => {
    const file = 'create_user.routine';
    const reparsed = parseRoutineFile(readFileSync(join(repo, 'e2e/routines/create_user.routine'), 'utf8'), file);
    expect(routineProblems(reparsed, [...defs, ...reparsed])).toEqual([]);
  });
  it('finds the routine around a line', () => {
    const two = parseRoutineFile('Routine: a\n\nstep\n\nRoutine: b\n\nstep', 'x');
    expect(routineAt(two, 2)?.signature).toBe('a');
    expect(routineAt(two, 6)?.signature).toBe('b');
  });
});

describe('@global rules', () => {
  it('accepts the repo globals file and flags empty, stray and duplicate rules', () => {
    expect(globalProblems(readFileSync(join(repo, 'e2e/features/global.feature'), 'utf8'))).toEqual([]);
    const p = globalProblems('@global close popups\n@global\n@global Close popups\n');
    expect(p.map((x) => [x.line, x.severity])).toEqual([
      [1, 'error'],
      [2, 'warning'],
    ]);
  });
  it('warns about an @global line inside a Gherkin feature (the runner ignores it there)', () => {
    const p = globalProblems('Feature: F\n  @global close popups\n  Scenario: S\n');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ line: 1, start: 2, severity: 'warning' });
  });
});
