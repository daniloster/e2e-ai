import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PlanCache } from '../cache.ts';
import { buildCatalog, catalogFingerprint } from '../catalog.ts';
import { parseFeature } from '../gherkin.ts';
import { stepPlanKey, globalPlanKey } from '../runner.ts';
import type { AppContext, StepPlan } from '../types.ts';
import { compileScenario, CompileError, readJUnit, runMaestroCloud, selector } from './maestroCloud.ts';

const target = { os: 'android' as const, appId: 'com.pocketnotes.e2e', scheme: 'pocketnotes', resetLink: 'e2e-reset', capabilities: { platformName: 'Android' } };
const routes = { signin: { description: 'sign in', mobile: 'signin' }, 'notes-session': { description: 'notes', mobile: 'notes?session={token}' } };
const plan = (step: string, actions: StepPlan['actions'], resolved: StepPlan['resolved'] = {}): StepPlan => ({ step, actions, resolved, model: 'm', createdAt: 'now' });
const step = (text: string, keyword: 'context' | 'action' | 'outcome' = 'action') => ({ keyword, text });
const consent = { ...plan('do not allow analytics', [{ kind: 'tap', target: 'No thanks button' }], { 'mobile:No thanks button': { testId: 'consent-deny', role: 'button', name: 'NO THANKS' } }), when: ['Help us improve Pocket Notes'] };

describe('Maestro flow compiler', () => {
  it('picks stable test ids, and accessible names for data-dependent ids', () => {
    expect(selector({ testId: 'signin-email', role: 'textbox', name: 'Email' })).toEqual(['id: "signin-email"']);
    expect(selector({ testId: 'note-delete-n2', role: 'button', name: 'Delete Buy milk' })).toEqual(['text: "(?i)Delete Buy milk"']);
    expect(selector({ role: 'button', name: 'Sign in' })).toEqual(['text: "(?i)Sign in"']);
  });

  it('turns a scenario into one flow: reset link, deep link with API facts, guarded UI steps, assertions', () => {
    const steps = [
      { step: step('I am signed in as "ana"', 'context'), plan: plan('signed in', [{ kind: 'call', fn: 'POST /auth/login' }, { kind: 'open', route: 'notes-session' }]) },
      {
        step: step('I add a note "Milk"'),
        plan: plan('add', [{ kind: 'fill', target: 'New note field', value: 'Milk' }, { kind: 'tap', target: 'Add note button' }], {
          'mobile:New note field': { testId: 'notes-new', role: 'textbox', name: 'New note' },
          'mobile:Add note button': { testId: 'notes-add', role: 'button', name: 'Add note' },
        }),
      },
      { step: step('I should see "Milk"', 'outcome'), plan: plan('see', [{ kind: 'expect_visible', target: 'note', value: 'Milk' }]) },
      { step: step('I should not see "Eggs"', 'outcome'), plan: plan('not see', [{ kind: 'expect_hidden', target: 'note', value: 'Eggs' }]) },
    ];
    const flow = compileScenario(steps, target, routes, { 'POST /auth/login#0': { token: 't-9' } }, [consent]);
    expect(flow.labels).toEqual(['step 1', 'step 2', 'step 3', 'step 4']);
    expect(flow.yaml).toBe(`appId: com.pocketnotes.e2e
---
- launchApp
- openLink: "pocketnotes://e2e-reset"
- openLink:
    link: "pocketnotes://notes?session=t-9"
    label: "step 1: I am signed in as \\"ana\\""
- runFlow:
    when:
      visible: "(?i).*Help us improve Pocket Notes.*"
    commands:
      - tapOn:
          id: "consent-deny"
          label: "global 1"
- tapOn:
    id: "notes-new"
    label: "step 2: I add a note \\"Milk\\""
- eraseText: 60
- inputText:
    text: "Milk"
    label: "step 2: I add a note \\"Milk\\""
- runFlow:
    when:
      visible: "(?i).*Help us improve Pocket Notes.*"
    commands:
      - tapOn:
          id: "consent-deny"
          label: "global 1"
- tapOn:
    id: "notes-add"
    label: "step 2: I add a note \\"Milk\\""
- runFlow:
    when:
      visible: "(?i).*Help us improve Pocket Notes.*"
    commands:
      - tapOn:
          id: "consent-deny"
          label: "global 1"
- assertVisible:
    text: "(?i).*Milk.*"
    label: "step 3: I should see \\"Milk\\""
- runFlow:
    when:
      visible: "(?i).*Help us improve Pocket Notes.*"
    commands:
      - tapOn:
          id: "consent-deny"
          label: "global 1"
- assertNotVisible:
    text: "(?i).*Eggs.*"
    label: "step 4: I should not see \\"Eggs\\""
`);
  });

  it('refuses what a whole-flow run cannot express, saying what to use instead', () => {
    const count = [{ step: step('there are 3 notes', 'outcome'), plan: plan('count', [{ kind: 'expect_count', target: 'notes', count: 3 }]) }];
    expect(() => compileScenario(count, target, routes, {}, [])).toThrow(/no recorded mobile group for "notes"/);
    const byRole = [{ step: step('there are 3 notes', 'outcome'), plan: plan('count', [{ kind: 'expect_count', target: 'notes', count: 3 }], { 'mobile:notes#group': { role: 'listitem', name: '', pattern: 'role:listitem' } }) }];
    expect(() => compileScenario(byRole, target, routes, {}, [])).toThrow(/Maestro cannot select by role/);
    const late = [
      { step: step('I open the sign in screen'), plan: plan('open', [{ kind: 'open', route: 'signin' }]) },
      { step: step('a user exists', 'context'), plan: plan('user', [{ kind: 'call', fn: 'POST /__test/users' }]) },
    ];
    expect(() => compileScenario(late, target, routes, {}, [])).toThrow(CompileError);
    const unrecorded = [{ step: step('I sign out'), plan: plan('out', [{ kind: 'tap', target: 'Sign out button' }]) }];
    expect(() => compileScenario(unrecorded, target, routes, {}, [])).toThrow(/run this suite once on a mobile target/);
    const noToken = [{ step: step('signed in', 'context'), plan: plan('s', [{ kind: 'open', route: 'notes-session' }]) }];
    expect(() => compileScenario(noToken, target, routes, {}, [])).toThrow('needs {token}');
  });

  it('counts with indexed matches on the recorded group: the N-th exists, the N+1-th does not', () => {
    const g = { 'mobile:notes in the list#group': { role: 'listitem', name: '', pattern: 'note-row-*' } };
    const three = compileScenario([{ step: step('I should see 3 notes', 'outcome'), plan: plan('c', [{ kind: 'expect_count', target: 'notes in the list', count: 3 }], g) }], target, routes, {}, []);
    expect(three.yaml).toContain(`- assertVisible:
    id: "note-row.+"
    index: 2
    label: "step 1: I should see 3 notes"
- assertNotVisible:
    id: "note-row.+"
    index: 3`);
    const none = compileScenario([{ step: step('I should see no notes', 'outcome'), plan: plan('c', [{ kind: 'expect_count', target: 'notes in the list', count: 0 }], g) }], target, routes, {}, []);
    expect(none.yaml).toContain(`- assertNotVisible:
    id: "note-row.+"
    label`);
  });

  it('reads the first failure of a JUnit report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'junit-'));
    writeFileSync(join(dir, 'report.xml'), '<testsuite><testcase name="a"><failure message="Element not found: step 3: I should see &quot;Milk&quot;">trace</failure></testcase></testsuite>');
    expect(readJUnit(dir)).toEqual({ failed: true, message: 'Element not found: step 3: I should see "Milk" trace' });
    expect(readJUnit(join(dir, 'none'))).toEqual({ failed: false, message: '' });
  });
});

describe('runMaestroCloud', () => {
  it('resets and seeds through the API, runs one flow per scenario, maps a failure to its step', async () => {
    const api: string[] = [];
    const context: AppContext = {
      name: 'Notes',
      description: 'Consent sheet "Help us improve Pocket Notes"',
      pockets: [
        {
          name: '',
          description: '',
          data: {
            'POST /__test/users': { description: 'user', params: {}, run: async () => void api.push('users') },
            'POST /auth/login': { description: 'login', params: {}, run: async () => (api.push('login'), { token: 't-1' }) },
          },
          routes,
        },
      ],
      beforeScenario: async () => void api.push('reset'),
    };
    const catalog = buildCatalog(context);
    const fp = catalogFingerprint(catalog);
    const store = new Map<string, StepPlan>();
    const cache: PlanCache = { path: ':memory:', get: (k) => store.get(k), set: (k, p) => void store.set(k, p), save() {} };
    const [ok, bad] = parseFeature(
      `Feature: Notes
  Scenario: Signed in
    Given I am signed in as "ana"
    Then I should see "My notes"
  Scenario: Missing note
    Given I am signed in as "ana"
    Then I should see "Ghost"
`,
      'notes.feature',
    );
    const signedIn = plan('signed in', [{ kind: 'call', fn: 'POST /__test/users' }, { kind: 'call', fn: 'POST /auth/login' }, { kind: 'open', route: 'notes-session' }]);
    store.set(stepPlanKey(ok!.steps[0]!, fp), signedIn);
    store.set(stepPlanKey(ok!.steps[1]!, fp), plan('see', [{ kind: 'expect_visible', target: 'heading', value: 'My notes' }]));
    store.set(stepPlanKey(bad!.steps[1]!, fp), plan('ghost', [{ kind: 'expect_visible', target: 'note', value: 'Ghost' }]));
    store.set(globalPlanKey('do not allow analytics', fp, context.description), consent);
    const workDir = mkdtempSync(join(tmpdir(), 'mc-'));
    const runs: string[][] = [];
    const reports = await runMaestroCloud([ok!, bad!], {
      context,
      cache,
      globals: [{ text: 'do not allow analytics', file: 'global.feature', line: 1, endLine: 1 }],
      cloud: { provider: 'saucelabs', username: 'sam', accessKey: 'k-secret', app: 'storage:app-1' },
      target,
      workDir,
      maestroRunner: ['npx', 'maestro-runner'],
      exec: async (bin, args) => {
        runs.push([bin, ...args]);
        const out = args[args.indexOf('--output') + 1] as string;
        const flow = readFileSync(args.at(-1) as string, 'utf8');
        if (flow.includes('Ghost')) {
          mkdirSync(out, { recursive: true });
          writeFileSync(join(out, 'junit.xml'), '<testsuite><testcase><failure message="Assertion is false: step 2: I should see &quot;Ghost&quot;"/></testcase></testsuite>');
          return { stdout: '', stderr: '', code: 1 };
        }
        return { stdout: 'ok', stderr: '', code: 0 };
      },
    });
    expect(api).toEqual(['reset', 'users', 'login', 'reset', 'users', 'login']);
    expect(reports.map((r) => r.status)).toEqual(['passed', 'failed']);
    expect(reports[1]?.steps.map((s) => s.status)).toEqual(['passed', 'failed']);
    expect(reports[1]?.steps[1]?.error).toContain('Assertion is false: step 2');
    const [bin, ...args] = runs[0] ?? [];
    expect([bin, args[0]]).toEqual(['npx', 'maestro-runner']);
    const hub = args[args.indexOf('--appium-url') + 1] as string;
    expect(hub).toBe('https://sam:k-secret@ondemand.us-west-1.saucelabs.com/wd/hub');
    const caps = JSON.parse(readFileSync(args[args.indexOf('--caps') + 1] as string, 'utf8')) as Record<string, Record<string, unknown>>;
    expect(caps['appium:app']).toBe('storage:app-1');
    expect(caps['sauce:options']?.accessKey).toBeUndefined(); // credentials only in the hub URL
  });
});
