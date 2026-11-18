import { describe, expect, it } from 'vitest';

import { buildCatalog } from './catalog.ts';
import { parseUiAutomator } from './drivers/adb.ts';
import { parseFeature } from './gherkin.ts';
import { ground, groundGroup } from './grounder.ts';
import type { Llm } from './llm.ts';
import { coverQuotes, dedupe, guardActions, kindsFor, NAVIGATION, orderFillsFirst, planStep, quotedValues } from './planner.ts';
import type { AppContext, UiElement } from './types.ts';

const ctx: AppContext = {
  name: 'T',
  description: 't',
  pockets: [
    {
      name: 'notes',
      description: '',
      data: {
        createNote: {
          description: 'note',
          params: {
            owner: { type: 'string', description: '' },
            title: { type: 'string', description: '' },
          },
          run: async () => undefined,
        },
      },
      routes: { signin: { description: 'sign in', web: '/s' } },
    },
  ],
};
const cat = buildCatalog(ctx);

/** A scripted LLM: returns the queued answers in order and records prompts. */
function fakeLlm(answers: unknown[]): Llm & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    model: 'fake',
    stats: { calls: 0, promptTokens: 0, outputTokens: 0, ms: 0 },
    prompts,
    async json<T>(req: { prompt: string }) {
      prompts.push(req.prompt);
      return answers.shift() as T;
    },
  };
}

const raw = (o: Partial<{ kind: string; fn: string; route: string; target: string; value: string; count: number }>) =>
  ({ kind: 'tap', fn: '', route: '', target: '', value: '', count: 0, ...o }) as never;

describe('gherkin', () => {
  it('expands backgrounds and outlines, classifies keywords, and keeps tables', () => {
    const scs = parseFeature(`Feature: F
  Background:
    Given a user exists
  Scenario Outline: O
    When I add "<t>"
    And I see it
    Then it shows
    Examples:
      | t |
      | A |
      | B |
  Scenario: T
    Given these:
      | title |
      | X     |
`);
    expect(scs).toHaveLength(3);
    expect(scs[0]?.steps.map((s) => [s.keyword, s.text])).toEqual([
      ['context', 'a user exists'],
      ['action', 'I add "A"'],
      ['action', 'I see it'],
      ['outcome', 'it shows'],
    ]);
    expect(scs[2]?.steps[1]?.table).toEqual([{ title: 'X' }]);
  });
});

describe('planner guards', () => {
  it('restricts kinds by keyword', () => {
    expect(kindsFor('outcome').every((k) => k.startsWith('expect_'))).toBe(true);
    expect(kindsFor('action')).not.toContain('call');
    expect(kindsFor('context')).toContain('call');
  });

  it('snaps an invented value to the nearest quoted value', () => {
    const r = guardActions([raw({ kind: 'fill', target: 'Title', value: 'Buy milk please' })], {
      step: 'I add "Buy milk"',
      keyword: 'action',
      facts: {},
    }, cat);
    expect(r.actions[0]?.value).toBe('Buy milk');
    expect(r.guardFixes).toHaveLength(1);
  });

  it('keeps a value that comes from the facts', () => {
    const r = guardActions([raw({ kind: 'fill', target: 'Password', value: 'pw1' })], {
      step: 'I sign in as Ana',
      keyword: 'action',
      facts: { user: { password: 'pw1' } },
    }, cat);
    expect(r.actions[0]?.value).toBe('pw1');
  });

  it('drops calls to functions that are not in the catalog', () => {
    const r = guardActions([raw({ kind: 'call', fn: 'nope.fn' })], { step: 'x', keyword: 'context', facts: {} }, cat);
    expect(r.actions).toEqual([]);
  });

  it('orders fills before taps and attaches dropped quotes', () => {
    const fixes: string[] = [];
    const ordered = orderFillsFirst(
      [{ kind: 'tap', target: 'Go' }, { kind: 'fill', target: 'A', value: 'a' }],
      fixes,
    );
    expect(ordered.map((a) => a.kind)).toEqual(['fill', 'tap']);
    const covered = coverQuotes([{ kind: 'tap', target: 'Delete button' }], ['Milk'], fixes);
    expect(covered[0]?.value).toBe('Milk');
  });

  it('fans a data table out into one call per row, deterministically', async () => {
    const llm = fakeLlm([
      { actions: [raw({ kind: 'call', fn: 'notes.createNote' })] },
      { owner: 'bo@x.com', title: 'Eggs' },
    ]);
    const r = await planStep(llm, cat, {
      step: '"bo@x.com" has these notes: [...]',
      keyword: 'context',
      facts: {},
      table: [{ title: 'Eggs' }, { title: 'Bread' }, { title: 'Oil' }],
    });
    expect(r.actions.map((a) => a.args)).toEqual([
      { owner: 'bo@x.com', title: 'Eggs' },
      { owner: 'bo@x.com', title: 'Bread' },
      { owner: 'bo@x.com', title: 'Oil' },
    ]);
  });

  it('drops a spurious open and re-asks without open in the grammar', async () => {
    const llm = fakeLlm([
      { actions: [raw({ kind: 'open', route: 'signin' })] },
      { actions: [raw({ kind: 'tap', target: 'Sign out button' })] },
    ]);
    const r = await planStep(llm, cat, { step: 'I log out', keyword: 'action', facts: {} });
    expect(r.actions).toEqual([{ kind: 'tap', target: 'Sign out button' }]);
    expect(r.guardFixes).toContain('re-asked without open');
    expect(NAVIGATION.test('I open the sign in screen')).toBe(true);
    expect(NAVIGATION.test('I log out')).toBe(false);
  });

  it('collapses consecutive duplicate actions', () => {
    const fixes: string[] = [];
    expect(dedupe([{ k: 1 }, { k: 1 }, { k: 2 }, { k: 1 }], fixes)).toEqual([{ k: 1 }, { k: 2 }, { k: 1 }]);
    expect(fixes).toHaveLength(1);
  });

  it('finds quoted values', () => {
    expect(quotedValues(`I add "A b" and 'C'`)).toEqual(['A b', 'C']);
  });
});

const notesScreen: UiElement[] = [
  { ref: '0', role: 'button', name: 'Add note', text: 'Add note', testId: 'notes-add' },
  { ref: '1', role: 'textbox', name: 'New note', text: '', testId: 'notes-new' },
  { ref: '2', role: 'listitem', name: 'Milk ×', text: 'Milk ×', testId: 'note-row-n2' },
  { ref: '3', role: 'checkbox', name: 'Milk', text: 'Milk', testId: 'note-done-n2' },
  { ref: '4', role: 'button', name: 'Delete Milk', text: '×', testId: 'note-delete-n2' },
  { ref: '5', role: 'listitem', name: 'Eggs ×', text: 'Eggs ×', testId: 'note-row-n3' },
  { ref: '6', role: 'button', name: 'Sign out', text: 'Sign out', testId: 'notes-signout' },
];

describe('grounder', () => {
  it('prefers the element whose purpose matches over the one named exactly like the quote', async () => {
    const r = await ground(notesScreen, 'Delete button of note "Milk"', 'tap');
    expect(r.element?.testId).toBe('note-delete-n2');
  });

  it('never grounds a quoted target to an element that does not show the quote', async () => {
    const r = await ground(notesScreen, 'Delete button of note "Bread"', 'tap');
    expect(r.element).toBeUndefined();
  });

  it('only fills text boxes', async () => {
    const r = await ground(notesScreen, 'New note field', 'fill');
    expect(r.element?.testId).toBe('notes-new');
  });

  it('asks the model by meaning when no word matches, and accepts "none"', async () => {
    const yes = await ground(notesScreen, 'Logout button', 'tap', { llm: fakeLlm([{ choice: '4' }]) });
    expect(yes.element?.testId).toBe('notes-signout');
    const no = await ground(notesScreen, 'Logout button', 'tap', { llm: fakeLlm([{ choice: 'none' }]) });
    expect(no.element).toBeUndefined();
  });

  it('groups list rows for counting', () => {
    expect(groundGroup(notesScreen, 'notes in the list')).toMatchObject({ key: 'note-row-*' });
    expect(groundGroup(notesScreen, 'notes in the list')?.items).toHaveLength(2);
  });
});

describe('adb uiautomator parser', () => {
  it('maps resource-id, content-desc, EditText and checkable', () => {
    const xml = `<hierarchy><node class="android.widget.EditText" text="" content-desc="Email" resource-id="signin-email" clickable="true" checkable="false" bounds="[0,100][400,160]" />
<node class="android.view.ViewGroup" text="" content-desc="Milk" resource-id="note-done-n2" clickable="true" checkable="true" checked="true" bounds="[0,200][200,260]" /></hierarchy>`;
    const nodes = parseUiAutomator(xml);
    expect(nodes.map((n) => n.el)).toEqual([
      { ref: '0', role: 'textbox', name: 'Email', text: '', testId: 'signin-email', value: '' },
      { ref: '1', role: 'checkbox', name: 'Milk', text: '', testId: 'note-done-n2', checked: true },
    ]);
    expect(nodes[0]).toMatchObject({ cx: 200, cy: 130 });
  });
});
