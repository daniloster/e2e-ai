import { describe, expect, it } from 'vitest';

import type { PlanCache } from './cache.ts';
import { parseFeature } from './gherkin.ts';
import { isGlobalSource, parseGlobals } from './globalSyntax.ts';
import { groundTriggers } from './globals.ts';
import type { Llm } from './llm.ts';
import { runScenario } from './runner.ts';
import type { AppContext, Driver, StepPlan, UiElement } from './types.ts';

const raw = (o: Partial<{ kind: string; target: string; value: string }>) =>
  ({ kind: 'tap', fn: '', route: '', target: '', value: '', count: 0, ...o }) as never;

describe('@global syntax', () => {
  it('reads each rule to the next @global, joining lines and skipping comments', () => {
    const src = `# standing rules
@global do not allow firebase user analytics

@global when a "What's new" sheet appears,
        close it
# trailing comment
`;
    expect(isGlobalSource(src)).toBe(true);
    const { rules, problems } = parseGlobals(src, 'e2e/features/global.feature');
    expect(problems).toEqual([]);
    expect(rules).toEqual([
      { text: 'do not allow firebase user analytics', file: 'e2e/features/global.feature', line: 2, endLine: 2 },
      { text: `when a "What's new" sheet appears, close it`, file: 'e2e/features/global.feature', line: 4, endLine: 5 },
    ]);
  });

  it('tells Gherkin files apart and reports empty, stray and duplicate rules', () => {
    expect(isGlobalSource('#notes\nFeature: Notes\n  Scenario: x')).toBe(false);
    const { rules, problems } = parseGlobals('stray text\n@global\n@global close popups\n@global Close popups\n');
    expect(rules.map((r) => r.text)).toEqual(['close popups', 'Close popups']);
    expect(problems.map((p) => [p.line, p.message.split(' (')[0]])).toEqual([
      [1, 'text before the first @global'],
      [2, 'empty @global: write the rule after @global'],
      [4, 'duplicate @global'],
    ]);
  });
});

describe('@global trigger guard', () => {
  it('keeps only trigger texts found in the docs or the rule', () => {
    const fixes: string[] = [];
    const docs = 'Consent sheet: title "Help us improve Pocket Notes", buttons No thanks and Allow.';
    expect(groundTriggers(['"Help us improve Pocket Notes"', 'Enable tracking?', 'ok'], docs, 'do not allow analytics', fixes)).toEqual([
      'Help us improve Pocket Notes',
    ]);
    expect(fixes).toEqual(['dropped trigger "Enable tracking?" (not in the docs)', 'dropped trigger "ok" (too short)']);
  });

  it('prefers quoted on-screen texts over the guide prose about the screen', () => {
    const fixes: string[] = [];
    const docs = 'Consent sheet: title "Help us improve Pocket Notes", asks to allow anonymous usage statistics; buttons **No thanks** and **Allow**.';
    expect(groundTriggers(['Help us improve Pocket Notes', 'allow anonymous usage statistics'], docs, 'do not allow analytics', fixes)).toEqual([
      'Help us improve Pocket Notes',
    ]);
    expect(fixes).toEqual(['dropped trigger "allow anonymous usage statistics" (describes the screen; not a quoted on-screen text)']);
  });
});

// ---------------------------------------------------------------- runtime

/** A notes screen covered by a consent sheet until "No thanks" is tapped. */
function sheetDriver(): Driver & { taps: string[] } {
  let sheet = true;
  const taps: string[] = [];
  const screen = (): UiElement[] => [
    ...(sheet
      ? [
          { ref: '0', role: 'heading', name: 'Help us improve Pocket Notes', text: 'Help us improve Pocket Notes' },
          { ref: '1', role: 'button', name: 'No thanks', text: 'No thanks', testId: 'consent-deny' },
          { ref: '2', role: 'button', name: 'Allow', text: 'Allow', testId: 'consent-allow' },
        ]
      : []),
    { ref: '3', role: 'button', name: 'Add note', text: 'Add note', testId: 'notes-add' },
  ];
  return {
    platform: 'mobile',
    name: 'fake',
    taps,
    async start() {},
    async stop() {},
    async resetApp() {
      sheet = true;
    },
    async openRoute() {},
    async snapshot() {
      return screen();
    },
    async tap(ref) {
      const el = screen().find((e) => e.ref === ref);
      taps.push(el?.name ?? ref);
      if (el?.testId === 'consent-deny' && sheet) sheet = false;
      else if (sheet) throw new Error('the sheet covers the screen');
    },
    async fill() {},
  };
}

function memoryCache(): PlanCache & { data: Map<string, StepPlan> } {
  const data = new Map<string, StepPlan>();
  return { path: ':memory:', data, get: (k) => data.get(k), set: (k, p) => void data.set(k, p), save() {} };
}

/** Answers by request: the @global split, the planned DO step, the scenario's own step. */
function scriptedLlm(): Llm & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: 'fake',
    stats: { calls: 0, promptTokens: 0, outputTokens: 0, ms: 0 },
    calls,
    async json<T>(req: { prompt: string; schema: Record<string, unknown> }) {
      calls.push(req.prompt);
      const props = (req.schema as { properties?: Record<string, unknown> }).properties ?? {};
      if ('when_visible' in props) return { when_visible: ['Help us improve Pocket Notes', 'Cookies?'], do: 'tap No thanks' } as T;
      if (req.prompt.includes('No thanks')) return { actions: [raw({ target: 'No thanks button' })] } as T;
      return { actions: [raw({ target: 'Add note button' })] } as T;
    },
  };
}

const context: AppContext = {
  name: 'Pocket Notes',
  description: 'Consent sheet: title "Help us improve Pocket Notes", buttons No thanks and Allow.',
  pockets: [{ name: '', description: '' }],
};
const rule = { text: 'do not allow firebase user analytics', file: 'e2e/features/global.feature', line: 1, endLine: 1 };
const [scenario] = parseFeature('Feature: Notes\n  Scenario: Add\n    When I tap Add note\n', 'notes.feature');

describe('@global rules at run time', () => {
  it('plans a rule once, fires it when its trigger is on screen, and records it on the step', async () => {
    const driver = sheetDriver();
    const cache = memoryCache();
    const llm = scriptedLlm();
    const r = await runScenario(scenario!, { context, driver, llm, cache, globals: [rule], timeoutMs: 300 });
    expect(r.status).toBe('passed');
    expect(driver.taps).toEqual(['No thanks', 'Add note']);
    expect(r.steps[0]?.globals).toEqual([
      { rule: rule.text, at: 'e2e/features/global.feature:1', actions: [{ kind: 'tap', target: 'No thanks button' }] },
    ]);
    const stored = [...cache.data.values()].find((p) => p.when);
    expect(stored?.when).toEqual(['Help us improve Pocket Notes']); // "Cookies?" is in no doc: dropped
    // The second scenario reuses the plan: no new @global planning call.
    const before = llm.calls.length;
    await runScenario(scenario!, { context, driver: sheetDriver(), llm, cache, globals: [rule], timeoutMs: 300 });
    expect(llm.calls.slice(before).some((p) => p.startsWith('Rule:'))).toBe(false);
  });

  it('without the rule the sheet blocks the step', async () => {
    const r = await runScenario(scenario!, { context, driver: sheetDriver(), llm: scriptedLlm(), cache: memoryCache(), timeoutMs: 300 });
    expect(r.status).toBe('failed');
  });

  it('fails up front in replay when a rule has no reviewed plan', async () => {
    const r = await runScenario(scenario!, { context, driver: sheetDriver(), cache: memoryCache(), globals: [rule], timeoutMs: 300 });
    expect(r.status).toBe('failed');
    expect(r.steps[0]?.error).toContain('has no reviewed plan');
  });
});
