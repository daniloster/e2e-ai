import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { matchesTags, preprocessFeature } from './dialect.ts';
import { lookupFact, parseApiDoc, parseAppGuide, parseExampleAction } from './docs.ts';
import { parseFeature } from './gherkin.ts';
import { fillTemplate } from './mcp/mcpDriver.ts';
import { arrange, contradicts, echoRatio, findSlots, lastSentence, templateBrief, templateSections, verifyAiText } from './report.ts';
import { expandCall, loadRoutines } from './routines.ts';
import { matchRoutine, parseRoutineFile } from './routineSyntax.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

describe('markdown docs → app context', () => {
  it('parses REST endpoints, fields, auth and path params', () => {
    const eps = parseApiDoc(read('e2e/docs/notes-api.md'), 'notes-api.md');
    const users = eps.find((e) => e.id === 'POST /__test/users');
    expect(users?.fields.map((f) => [f.name, f.required])).toEqual([
      ['email', true],
      ['password', true],
      ['name', false],
    ]);
    expect(eps.find((e) => e.id === 'POST /notes')?.auth).toBe(true);
    expect(eps.find((e) => e.id === 'DELETE /notes/{id}')?.fields[0]?.name).toBe('id');
  });
  it('recognises GraphQL and gRPC headings (not executed in the spike)', () => {
    const eps = parseApiDoc('### MUTATION createNote\n| Field | Type | Required |\n|---|---|---|\n| title | String | yes |\n### RPC notes.v1.Notes/Create\n');
    expect(eps.map((e) => [e.id, e.protocol])).toEqual([
      ['MUTATION createNote', 'graphql'],
      ['RPC notes.v1.Notes/Create', 'grpc'],
    ]);
  });
  it('parses the app guide: routes, before-each, glossary and examples', () => {
    const g = parseAppGuide(read('e2e/docs/app-guide.md'));
    expect(g.routes['notes-session']).toMatchObject({ web: '/app.html?session={token}#/notes', mobile: 'notes?session={token}' });
    expect(g.beforeEach).toEqual(['POST /__test/reset']);
    expect(Object.keys(g.glossary)).toContain('signed in as X');
    expect(g.examples.find((e) => e.step.includes('signed in as'))?.actions).toEqual([
      { kind: 'call', fn: 'POST /auth/login' },
      { kind: 'open', route: 'notes-session' },
    ]);
  });
  it('reads example actions', () => {
    expect(parseExampleAction('expect count notes in the list = 3')).toEqual({ kind: 'expect_count', target: 'notes in the list', count: 3 });
    expect(parseExampleAction('fill Email field = "a@b.c"')).toEqual({ kind: 'fill', target: 'Email field', value: 'a@b.c' });
  });
  it('finds the newest fact value and fills route templates', () => {
    const facts = { a: { response: { token: 'old' } }, b: { request: { email: 'x' }, response: { token: 't-2' } } };
    expect(lookupFact(facts, 'token')).toBe('t-2');
    expect(fillTemplate('/app.html?session={token}#/notes', { token: 't 2' })).toBe('/app.html?session=t%202#/notes');
  });
});

describe('feature dialect', () => {
  it('turns #tags into tags, keeps # comments, and makes @routine lines steps', () => {
    const { gherkin } = preprocessFeature('#smoke #team-atlas\n# a comment\nFeature: F\n  Background:\n    @routine do "x"\n  Scenario: S\n    Then ok');
    expect(gherkin.split('\n').slice(0, 5)).toEqual(['@smoke @team-atlas', '# a comment', 'Feature: F', '  Background:', '    * @routine do "x"']);
  });
  it('scopes each Background to the scenarios below it, with original line numbers', () => {
    const scs = parseFeature(read('e2e/features/seeding.feature'), 'seeding.feature');
    expect(scs.map((s) => [s.name, s.rule, s.line])).toEqual([
      ['Several notes from a table', 'Background 1', 13],
      ['Notes of another user stay private', 'Background 2', 26],
      ['user with single note', 'Background 2', 32],
    ]);
    expect(scs[1]?.steps.filter((s) => s.background).length).toBe(2);
    expect(scs[1]?.tags).toEqual(['#seeding', '#team-atlas', '#security', '#privacy']);
  });
  it('a new Background replaces the previous one for the scenarios below it (seeding.feature)', () => {
    const scs = parseFeature(read('e2e/features/seeding.feature'), 'seeding.feature');
    const bg = (i: number) => scs[i]?.steps.filter((s) => s.background).map((s) => s.text.replace(/\s*\[\{.*$/, ''));
    // Scenario 1: only Background 1 (Bo + Eggs/Bread/Olive oil).
    expect(bg(0)).toEqual(['@routine create user "bo@example.com" with password "pa55word" and notes:']);
    expect(scs[0]?.steps[0]?.table?.map((r) => r.title)).toEqual(['Eggs', 'Bread', 'Olive oil']);
    // Scenarios 2 and 3: only Background 2 (Ana, Bo + "Bo's secret") — nothing from Background 1.
    for (const i of [1, 2]) {
      expect(bg(i)).toEqual([
        '@routine create user with login "ana@example.com" and password "s3cret!"',
        '@routine create user "bo@example.com" with password "pa55word" and notes:',
      ]);
      expect(scs[i]?.steps[1]?.table?.map((r) => r.title)).toEqual(["Bo's secret"]);
    }
  });
  it('filters by tags', () => {
    expect(matchesTags(['#notes', '#smoke'], '#smoke')).toBe(true);
    expect(matchesTags(['#notes', '#smoke'], '#auth,!#smoke')).toBe(false);
    expect(matchesTags(['#notes'], '!#slow')).toBe(true);
  });
});

describe('routines', () => {
  const lib = loadRoutines(join(repo, 'e2e/routines'), repo);
  it('expands nested routines and each-loops with the caller scope', async () => {
    const steps = await expandCall('create user "bo@x.com" with password "pw" and notes:', [{ title: 'Eggs', description: 'Brown' }, { title: 'Bread', description: '' }], 'context', { lib });
    expect(steps.map((s) => s.text)).toEqual([
      'create a user "bo@x.com" with password "pw" via API',
      'create a note with title "Eggs" and description "Brown" via API',
      'create a note with title "Bread" and description "" via API',
    ]);
    expect(steps[1]?.scope.email).toBe('bo@x.com');
    expect(steps[1]?.origin.map((o) => o.file.split('/').pop())).toEqual(['create_user_with_notes.routine', 'create_notes.routine']);
  });
  it('fails loudly on a missing table and an unknown routine', async () => {
    await expect(expandCall('create user "a" with password "b" and notes:', undefined, 'context', { lib })).rejects.toThrow(/needs a data table/);
    await expect(expandCall('archive everything', undefined, 'context', { lib })).rejects.toThrow(/no routine matches/);
  });
  it('prefers the signature with more literal text', () => {
    const defs = parseRoutineFile('Routine: user "${a}"\n\nx\n\nRoutine: user "${a}" has notes: ${table:n[title]}\n\ny');
    expect(matchRoutine('user "bo" has notes:', defs)?.def.signature).toMatch(/has notes/);
  });
});

describe('report guards', () => {
  const data = { facts: ['4 of 6 scenarios passed (67%).', 'Failed: "Login works"'] };
  it('rejects invented numbers, names and files', () => {
    expect(verifyAiText('4 of 6 passed (67%).', data).ok).toBe(true);
    expect(verifyAiText('5 of 6 passed.', data).reason).toMatch(/5/);
    expect(verifyAiText('"Checkout works" failed.', data).ok).toBe(false);
    expect(verifyAiText('See pay.feature:12.', data).ok).toBe(false);
    expect(verifyAiText('Login fails 因为', data).reason).toMatch(/script/);
  });
  it('rejects tone and verdicts that contradict the result, but accepts negations', () => {
    expect(contradicts('No user-facing behaviour is broken.', 0)).toBeUndefined();
    expect(contradicts('Please investigate #auth.', 0)).toMatch(/concerns/);
    expect(contradicts('The build can ship.', 2)).toMatch(/can ship/);
    expect(contradicts('The build cannot ship yet.', 2)).toBeUndefined();
    expect(contradicts('All scenarios passed.', 1)).toMatch(/success/);
  });
  it('detects a model echoing its instructions', () => {
    const brief = 'Audience: a product owner deciding whether the build can ship. They want a one-line verdict and the health of each team.';
    expect(echoRatio('Audience: a product owner deciding whether the build can ship. They want a one-line verdict.', brief)).toBeGreaterThan(0.5);
    expect(echoRatio('Four of six checks passed; sign in is broken for team atlas.', brief)).toBe(0);
  });
  it('reads the template brief, slots and sections; pinned sections keep their place', () => {
    const t = read('e2e/reports/templates/engineering.html');
    expect(templateBrief(t)).toMatch(/^Audience: the engineers/);
    expect(findSlots(t).map((x) => x.name)).toEqual(['summary', 'failure-notes']);
    const secs = templateSections(t);
    expect(secs.find((x) => x.name === 'kpis')).toMatchObject({ pinned: true, required: true });
    expect(arrange(secs, ['summary', 'failures', 'scenarios', 'tables', 'kpis'])).toEqual(['kpis', 'summary', 'failures', 'scenarios', 'tables']);
  });
  it('trims a capped answer to its last sentence', () => {
    expect(lastSentence('One. Two is cut')).toBe('One.');
  });
});

describe('model specs and benchmark recommendation', async () => {
  const { parseModelSpecs } = await import('./llm.ts');
  const { recommend } = await import('./benchmark.ts');
  it('parses "name">>endpoint lists, defaulting the endpoint', () => {
    const d = { provider: 'openai' as const, endpoint: 'http://cfg/v1', name: 'x' };
    expect(parseModelSpecs('"qwen3:4b"@http://a:11434/v1;"qwen3:1.7b"@http://b:8080/v1', d).map((m) => [m.name, m.endpoint])).toEqual([
      ['qwen3:4b', 'http://a:11434/v1'],
      ['qwen3:1.7b', 'http://b:8080/v1'],
    ]);
    expect(parseModelSpecs('qwen3:0.6b', d)[0]).toMatchObject({ name: 'qwen3:0.6b', endpoint: 'http://cfg/v1', provider: 'openai' });
    expect(parseModelSpecs('qwen3:4b@http://a/v1', d)[0]).toMatchObject({ name: 'qwen3:4b', endpoint: 'http://a/v1' });
    expect(parseModelSpecs('"x">>http://legacy/v1', d)[0]).toMatchObject({ name: 'x', endpoint: 'http://legacy/v1' });
  });
  it('takes a hosted model\'s key (by env var name) and reasoning effort from [options]', () => {
    const d = { provider: 'openai' as const, endpoint: 'http://cfg/v1', name: 'x', apiKeyEnv: 'LOCAL_KEY' };
    const [m] = parseModelSpecs('"openai/gpt-oss-20b"@https://api.groq.com/openai/v1[key=GROQ_API_KEY, reasoning=low]', d);
    expect(m).toEqual({ provider: 'openai', name: 'openai/gpt-oss-20b', endpoint: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY', reasoningEffort: 'low' });
    // Another endpoint never inherits the default model's key; the default endpoint does.
    expect(parseModelSpecs('"y"@http://other/v1', d)[0]).not.toHaveProperty('apiKeyEnv');
    expect(parseModelSpecs('"y"', d)[0]).toMatchObject({ apiKeyEnv: 'LOCAL_KEY' });
    expect(() => parseModelSpecs('"y"@http://a/v1[key=gsk_live_secret]', d)).toThrow('key=ENV_VAR_NAME');
    expect(() => parseModelSpecs('"y"@http://a/v1[reasoning=max]', d)).toThrow('bad model option');
  });
  it('recommends by pass rate, then fewest repairs, then speed', () => {
    const m = (name: string, passRate: number, repairs: number, speed: number) =>
      ({ name, suite: { passRate, passed: passRate, scenarios: 100, guardFixes: repairs, replans: 0, msPerPlannedStep: speed }, planner: [] }) as never;
    expect(recommend([m('a', 90, 1, 100), m('b', 100, 9, 900), m('c', 100, 2, 900)])?.name).toBe('c');
    expect(recommend([m('a', 100, 2, 100), m('c', 100, 2, 900)])?.name).toBe('a');
  });
});

describe('integration parsers', async () => {
  const { parseXcuiSource } = await import('./drivers/appium.ts');
  const { parseMaestroHierarchy } = await import('./drivers/maestro.ts');
  const { parsePlaywrightSnapshot } = await import('./drivers/playwrightMcp.ts');
  const { groundGroup } = await import('./grounder.ts');
  it('reads an XCUITest page source (Appium iOS): testID → name, label, roles, centres', () => {
    const xml = `<AppiumAUT><XCUIElementTypeApplication name="PocketNotes" label="PocketNotes" visible="true" x="0" y="0" width="402" height="874">
<XCUIElementTypeTextField type="XCUIElementTypeTextField" name="signin-email" label="Email" value="" visible="true" x="16" y="200" width="370" height="44"/>
<XCUIElementTypeButton type="XCUIElementTypeButton" name="signin-submit" label="Sign in" visible="true" x="16" y="300" width="370" height="50"/>
<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Hidden" label="Hidden" visible="false" x="0" y="0" width="1" height="1"/>
</XCUIElementTypeApplication></AppiumAUT>`;
    const nodes = parseXcuiSource(xml);
    expect(nodes.map((n) => [n.el.role, n.el.name, n.el.testId])).toEqual([
      ['textbox', 'Email', 'signin-email'],
      ['button', 'Sign in', 'signin-submit'],
    ]);
    expect(nodes[1]).toMatchObject({ cx: 201, cy: 325 });
  });
  it('reads a Maestro hierarchy', () => {
    const json = JSON.stringify({
      attributes: {},
      children: [
        { attributes: { 'resource-id': 'notes-add', text: 'Add note', clickable: 'true', bounds: '[10,10][110,60]', enabled: 'true' } },
        { attributes: { 'resource-id': 'notes-new', class: 'android.widget.EditText', text: '', bounds: '[0,0][100,40]', enabled: 'true' } },
      ],
    });
    expect(parseMaestroHierarchy(json).map((n) => [n.el.role, n.el.testId, n.cx])).toEqual([
      ['button', 'notes-add', 60],
      ['textbox', 'notes-new', 50],
    ]);
  });
  it('reads the Playwright MCP ARIA snapshot and counts list items without test ids', () => {
    const snap = '### Snapshot\n```yaml\n- main [ref=e3]:\n  - textbox "Email" [ref=e7]\n  - button "Sign in" [ref=e10] [cursor=pointer]\n  - list [ref=e12]:\n    - listitem [ref=e13]:\n      - checkbox "Buy milk" [checked] [ref=e14]\n    - listitem [ref=e15]:\n      - generic [ref=e16]: Eggs\n```';
    const els = parsePlaywrightSnapshot(snap);
    expect(els.find((e) => e.ref === 'e10')).toMatchObject({ role: 'button', name: 'Sign in' });
    expect(els.find((e) => e.ref === 'e14')).toMatchObject({ role: 'checkbox', checked: true });
    expect(els.find((e) => e.ref === 'e16')).toMatchObject({ role: 'text', text: 'Eggs' });
    expect(groundGroup(els, 'notes in the list')?.items).toHaveLength(2);
  });
});

describe('--no-cache', async () => {
  const { openPlanCache } = await import('./cache.ts');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  it('reads nothing, reuses nothing and writes nothing', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nc-')), 'plans.json');
    writeFileSync(file, JSON.stringify({ k: { step: 's', actions: [], resolved: {}, model: 'm', createdAt: '' } }));
    const c = openPlanCache(file, { disabled: true });
    expect(c.get('k')).toBeUndefined();
    c.set('k2', { step: 's2', actions: [], resolved: {}, model: 'm', createdAt: '' });
    expect(c.get('k2')).toBeUndefined();
    c.save();
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['k']);
  });
});
