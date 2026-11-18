// Target description ("the Add note button", "note 'Milk'") → an element of the live snapshot.
// Deterministic scoring first (testId/name/text/placeholder token overlap, role fitness, exact quoted
// text); the LLM is asked only when the top candidates are ambiguous, and then only to pick an index
// from a short, enum-constrained list. This keeps a 1B model's job tiny and checkable.
import type { Llm } from './llm.ts';
import { quotedValues } from './planner.ts';
import type { ResolvedTarget, UiElement } from './types.ts';

export type Intent = 'tap' | 'fill' | 'read';

const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'my', 'i', 'is', 'and', 'should', 'see', 'be',
  'field', 'input', 'box', 'button', 'link', 'text', 'label', 'called', 'titled', 'named', 'that', 'it',
]);

export function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9@.]+/)
    .filter((t) => t.length > 0 && !STOP.has(t));
}

const ROLE_WORDS: Record<string, readonly string[]> = {
  button: ['button', 'btn', 'press', 'tap', 'click'],
  textbox: ['field', 'input', 'box', 'textbox', 'type'],
  checkbox: ['checkbox', 'check', 'tick', 'done', 'toggle'],
  link: ['link'],
  heading: ['heading', 'title', 'header'],
};

const INTERACTIVE = new Set(['button', 'link', 'checkbox', 'switch', 'textbox', 'menuitem', 'tab']);

function roleFit(el: UiElement, intent: Intent, desc: string): number {
  const d = desc.toLowerCase();
  let s = 0;
  for (const [role, words] of Object.entries(ROLE_WORDS)) {
    if (el.role === role && words.some((w) => d.includes(w))) s += 1.5;
  }
  if (intent === 'fill') s += el.role === 'textbox' ? 3 : -5;
  if (intent === 'tap') s += INTERACTIVE.has(el.role) ? 1 : -0.5;
  return s;
}

/** Content relevance only (no role bonus): tokens and quoted text the element shares with the description. */
// Unquoted words say what the element IS or DOES ("delete", "add", "email"); quoted text says WHICH
// one (a row's title). Purpose must outweigh identity, or "Delete button of 'Milk'" grounds to the
// row's checkbox named exactly "Milk" (seen on iOS in replay mode).
export function relevance(el: UiElement, desc: string): number {
  const quotes = quotedValues(desc);
  const unquoted = tokens(desc.replace(/"[^"]*"|'[^']*'/g, ' '));
  const quotedTokens = quotes.flatMap(tokens);
  const fields = [el.name, el.text, el.testId ?? '', el.placeholder ?? ''];
  const have = new Set(fields.flatMap(tokens));
  let s = 0;
  for (const t of unquoted) if (have.has(t)) s += 2;
  for (const t of quotedTokens) if (have.has(t)) s += 0.5;
  for (const q of quotes) {
    const ql = q.toLowerCase();
    if (el.name.toLowerCase() === ql || el.text.toLowerCase() === ql) s += 3;
    else if (el.name.toLowerCase().includes(ql) || el.text.toLowerCase().includes(ql)) s += 2;
  }
  return s;
}

export function scoreElement(el: UiElement, desc: string, intent: Intent): number {
  return relevance(el, desc) + roleFit(el, intent, desc);
}

export interface GroundResult {
  element?: UiElement;
  via: 'resolved' | 'score' | 'llm' | 'none';
  candidates: number;
}

export function matchesResolved(el: UiElement, r: ResolvedTarget): boolean {
  if (r.testId) return el.testId === r.testId;
  return el.role === r.role && el.name === r.name;
}

export function toResolved(el: UiElement): ResolvedTarget {
  return el.testId ? { testId: el.testId, role: el.role, name: el.name } : { role: el.role, name: el.name };
}

export function describeElement(el: UiElement): string {
  const bits = [`${el.role}`, `"${el.name || el.text}"`];
  if (el.testId) bits.push(`id=${el.testId}`);
  if (el.placeholder) bits.push(`placeholder="${el.placeholder}"`);
  if (el.checked !== undefined) bits.push(el.checked ? 'checked' : 'unchecked');
  return bits.join(' ');
}

export async function ground(
  elements: UiElement[],
  desc: string,
  intent: Intent,
  opts: { llm?: Llm; resolved?: ResolvedTarget; allowNone?: boolean } = {},
): Promise<GroundResult> {
  // Quoted text is identity: only elements showing it qualify (also guards against grounding to a
  // look-alike before an async list has rendered — the poller simply tries again).
  const quotes = quotedValues(desc).map((q) => q.toLowerCase());
  if (quotes.length > 0 && intent !== 'fill') {
    elements = elements.filter((e) =>
      quotes.some((q) => e.name.toLowerCase().includes(q) || e.text.toLowerCase().includes(q)),
    );
  }
  if (opts.resolved) {
    const hits = elements.filter((e) => matchesResolved(e, opts.resolved as ResolvedTarget));
    if (hits.length === 1) return { element: hits[0] as UiElement, via: 'resolved', candidates: 1 };
  }
  const scored = elements
    // An element must share content with the description; role fit alone never grounds (false-tap guard).
    .filter((el) => relevance(el, desc) >= 1)
    .map((el) => ({ el, s: scoreElement(el, desc, intent) }))
    .filter((x) => x.s > 0.5)
    .sort((a, b) => b.s - a.s);
  const [first, second] = scored;
  if (!first) {
    // No lexical match ("Logout button" vs "Sign out"): let the model pick among interactive
    // elements by meaning, with "none" allowed so it cannot be forced into a wrong pick.
    if (!opts.llm || intent === 'read' || quotes.length > 0) return { via: 'none', candidates: 0 };
    const pool = elements.filter((e) => (intent === 'fill' ? e.role === 'textbox' : INTERACTIVE.has(e.role))).slice(0, 12);
    if (pool.length === 0) return { via: 'none', candidates: 0 };
    const pick = await opts.llm.json<{ choice: string }>({
      system: 'You pick which UI element a test step refers to, by meaning (synonyms count). Answer with its number, or "none".',
      prompt: `Element wanted (${intent}): ${desc}\nElements:\n${pool.map((e, i) => `${i}: ${describeElement(e)}`).join('\n')}`,
      schema: { type: 'object', properties: { choice: { type: 'string', enum: [...pool.map((_, i) => String(i)), 'none'] } }, required: ['choice'] },
    });
    const chosen = pick.choice === 'none' ? undefined : pool[Number(pick.choice)];
    return chosen ? { element: chosen, via: 'llm', candidates: pool.length } : { via: 'none', candidates: pool.length };
  }
  // Clear winner: comfortably ahead of the runner-up.
  if (!second || first.s - second.s >= 1.5 || !opts.llm) {
    return { element: first.el, via: 'score', candidates: scored.length };
  }
  const top = scored.slice(0, 8);
  const choices = top.map((_, i) => String(i));
  if (opts.allowNone) choices.push('none');
  const list = top.map((x, i) => `${i}: ${describeElement(x.el)}`).join('\n');
  const pick = await opts.llm.json<{ choice: string }>({
    system:
      'You pick which UI element a test step refers to. Answer with the number of the best element' +
      (opts.allowNone ? ', or "none" if no element matches.' : '.'),
    prompt: `Element wanted (${intent}): ${desc}\nElements:\n${list}`,
    schema: { type: 'object', properties: { choice: { type: 'string', enum: choices } }, required: ['choice'] },
  });
  if (pick.choice === 'none') return { via: 'llm', candidates: top.length };
  const chosen = top[Number(pick.choice)];
  return chosen ? { element: chosen.el, via: 'llm', candidates: top.length } : { via: 'none', candidates: top.length };
}

/** Repeated elements (list rows) grouped by their testId with ids/numbers stripped: note-row-n3 → note-row-*. */
export function groupElements(elements: UiElement[]): Map<string, UiElement[]> {
  const groups = new Map<string, UiElement[]>();
  for (const el of elements) {
    if (!el.testId) continue;
    const key = el.testId.replace(/[-_:]?[a-z]?\d+[a-z0-9]*$/i, '-*');
    if (key === el.testId) continue;
    const list = groups.get(key) ?? [];
    list.push(el);
    groups.set(key, list);
  }
  return groups;
}

/** Picks the repeated group a count assertion talks about ("notes in the list" → note-row-*). */
export function groundGroup(elements: UiElement[], desc: string): { key: string; items: UiElement[] } | undefined {
  const want = tokens(desc).map((t) => t.replace(/s$/, ''));
  let best: { key: string; items: UiElement[]; s: number } | undefined;
  for (const [key, items] of groupElements(elements)) {
    const have = tokens(key).map((t) => t.replace(/s$/, ''));
    let s = 0;
    for (const t of want) if (have.includes(t)) s += 1;
    if (!best || s > best.s) best = { key, items, s };
  }
  if (best && best.s > 0) return { key: best.key, items: best.items };
  // Drivers that expose no test ids (Playwright MCP's ARIA snapshot): count list items/rows.
  if (!elements.some((e) => e.testId)) {
    const rows = elements.filter((e) => e.role === 'listitem' || e.role === 'row');
    if (rows.length) return { key: `role:${rows[0]?.role}`, items: rows };
  }
  return undefined;
}
