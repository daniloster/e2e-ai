// Run report: collects what happened (features, scenarios, steps, routine origins, errors,
// screenshots, plan sources) into ReportData, then renders an HTML template.
//
// Templates live in e2e/reports/templates/<name>.html and runs in e2e/reports/runs/<slug>/. A
// template is also the pocket model's prompt: its <script type="text/x-e2e-ai-brief"> says who the
// report is for and what matters; from it the model returns a VIEW PLAN (group by, sort, expand,
// section order, highlights, headline) constrained to the template's own sections/options and the
// run's scenario ids, so it fits the data to the template without being able to change a result.
// Narrative parts are AI slots:
//   <section data-ai="summary" data-ai-prompt="Summarise the run for a product owner…">fallback</section>
//   <div data-ai="failure-notes" data-ai-each="failure" data-ai-prompt="Explain the likely cause…"></div>
// The pocket model reads each slot's prompt and writes ONLY that text, from a compact digest of the
// data. Every number, quoted name and file:line it writes must exist in the data, or the text is
// rejected and a generated fallback is shown with the reason. Tables, counts, statuses and
// screenshots are always rendered from data — a small model never gets to make up a result.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Llm, LlmStats } from './llm.ts';
import type { ScenarioReport } from './runner.ts';

export interface FailureEntry {
  id: string;
  feature: string;
  file: string;
  scenario: string;
  scenarioLine?: number;
  step: string;
  stepLine?: number;
  error: string;
  routine?: string; // innermost routine file:line the failing step came from
  screenshot?: string;
  video?: string;
  at?: number; // seconds into the video where the failing step starts
}

export interface AiText {
  text: string;
  accepted: boolean;
  reason?: string; // why rejected / not generated
  model?: string;
  /** What the model wrote when it was rejected (kept in report.json for audit, never shown as fact). */
  rejected?: string;
}

export interface ViewPlan {
  groupBy: string;
  /** How the template shows screenshots/videos (from data-e2e-ai-media-options). */
  media?: string;
  sortBy: 'failed-first' | 'file' | 'name' | 'slowest';
  expand: 'failed' | 'all' | 'none';
  sections: string[];
  highlight: string[]; // scenario ids
  headline: string;
  accepted: boolean;
  reason?: string;
  model?: string;
}

export interface ReportData {
  title: string;
  generatedAt: string;
  startedAt: string;
  durationMs: number;
  run: { driver: string; platform: string; model: string | null; mode: 'plan' | 'replay' | 'no-cache'; tags: string | null; command: string; links?: { label: string; url: string }[] };
  totals: {
    features: number;
    scenarios: number;
    passed: number;
    failed: number;
    passRate: number;
    steps: number;
    stepsPassed: number;
    stepsFailed: number;
    stepsSkipped: number;
    fromCache: number;
    fromModel: number;
    guardFixes: number;
    heals: number;
    screenshots: number;
    videos: number;
  };
  llm: LlmStats | null;
  features: { file: string; name: string; tags: string[]; status: 'passed' | 'failed'; ms: number; passed: number; failed: number; scenarios: ScenarioReport[] }[];
  failures: FailureEntry[];
  tags: { tag: string; passed: number; failed: number }[];
  routines: { routine: string; file: string; steps: number; scenarios: number }[];
  ai: { sections: Record<string, AiText>; failures: Record<string, AiText>; model: string | null; view?: ViewPlan; template?: string };
}

export function collect(
  reports: ScenarioReport[],
  meta: { startedAt: Date; driver: string; platform: string; model: string | null; tags: string | null; command: string; llm: LlmStats | null; title?: string; noCache?: boolean; links?: { label: string; url: string }[] },
): ReportData {
  reports.forEach((r, i) => ((r as ScenarioReport & { id?: string }).id = `s${i + 1}`));
  const byFile = new Map<string, ScenarioReport[]>();
  for (const r of reports) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const features = [...byFile.entries()].map(([file, scs]) => {
    const failed = scs.filter((s) => s.status === 'failed').length;
    const tagSets = scs.map((s) => new Set(s.tags));
    const common = [...(tagSets[0] ?? [])].filter((t) => tagSets.every((set) => set.has(t)));
    return {
      file,
      name: scs[0]?.feature ?? file,
      tags: common,
      status: failed ? ('failed' as const) : ('passed' as const),
      ms: scs.reduce((n, s) => n + s.ms, 0),
      passed: scs.length - failed,
      failed,
      scenarios: scs,
    };
  });
  const steps = reports.flatMap((r) => r.steps);
  const failures: FailureEntry[] = [];
  reports.forEach((r, i) => {
    const st = r.steps.find((s) => s.status === 'failed');
    if (!st) return;
    const f: FailureEntry = { id: `s${i + 1}`, feature: r.feature, file: r.file, scenario: r.name, step: st.step, error: st.error ?? 'failed' };
    if (r.line !== undefined) f.scenarioLine = r.line;
    if (st.line !== undefined) f.stepLine = st.line;
    const inner = st.origin?.[st.origin.length - 1];
    if (inner) f.routine = `${inner.file}:${inner.line}`;
    if (st.screenshot) f.screenshot = st.screenshot;
    if (r.video) f.video = r.video;
    if (st.at !== undefined) f.at = st.at;
    failures.push(f);
  });
  const tagMap = new Map<string, { passed: number; failed: number }>();
  for (const r of reports)
    for (const t of r.tags) {
      const e = tagMap.get(t) ?? { passed: 0, failed: 0 };
      e[r.status === 'passed' ? 'passed' : 'failed']++;
      tagMap.set(t, e);
    }
  const routineMap = new Map<string, { routine: string; file: string; steps: number; scenarios: Set<string> }>();
  for (const r of reports)
    for (const s of r.steps)
      for (const o of s.origin ?? []) {
        const e = routineMap.get(o.routine) ?? { routine: o.routine, file: o.file, steps: 0, scenarios: new Set<string>() };
        e.steps++;
        e.scenarios.add(`${r.file}:${r.name}`);
        routineMap.set(o.routine, e);
      }
  const passed = reports.filter((r) => r.status === 'passed').length;
  return {
    title: meta.title ?? 'E2E run report',
    generatedAt: new Date().toISOString(),
    startedAt: meta.startedAt.toISOString(),
    durationMs: Date.now() - meta.startedAt.getTime(),
    run: { driver: meta.driver, platform: meta.platform, model: meta.model, mode: meta.noCache ? 'no-cache' : meta.model ? 'plan' : 'replay', tags: meta.tags, command: meta.command, ...(meta.links?.length ? { links: meta.links } : {}) },
    totals: {
      features: features.length,
      scenarios: reports.length,
      passed,
      failed: reports.length - passed,
      passRate: reports.length ? Math.round((100 * passed) / reports.length) : 0,
      steps: steps.length,
      stepsPassed: steps.filter((s) => s.status === 'passed').length,
      stepsFailed: steps.filter((s) => s.status === 'failed').length,
      stepsSkipped: steps.filter((s) => s.status === 'skipped').length,
      fromCache: steps.filter((s) => s.source === 'cache').length,
      fromModel: steps.filter((s) => s.source === 'llm').length,
      guardFixes: steps.reduce((n, s) => n + s.guardFixes.length, 0),
      heals: steps.reduce((n, s) => n + s.healed.length, 0),
      screenshots: steps.filter((s) => s.screenshot).length,
      videos: reports.filter((r) => r.video).length,
    },
    llm: meta.llm,
    features,
    failures,
    tags: [...tagMap.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => a.tag.localeCompare(b.tag)),
    routines: [...routineMap.values()].map((e) => ({ routine: e.routine, file: e.file, steps: e.steps, scenarios: e.scenarios.size })),
    ai: { sections: {}, failures: {}, model: null },
  };
}

// ---------------------------------------------------------------- AI slots

export interface AiSlot {
  name: string;
  prompt: string;
  each?: 'failure';
}

export function findSlots(template: string): AiSlot[] {
  const slots: AiSlot[] = [];
  for (const m of template.matchAll(/<[a-z][\w-]*\b[^>]*\bdata-ai="([\w-]+)"[^>]*>/gi)) {
    const tag = m[0];
    const prompt = /\bdata-ai-prompt="([^"]*)"/.exec(tag)?.[1] ?? '';
    const each = /\bdata-ai-each="failure"/.test(tag) ? ('failure' as const) : undefined;
    slots.push(each ? { name: m[1] as string, prompt: decodeEntities(prompt), each } : { name: m[1] as string, prompt: decodeEntities(prompt) });
  }
  return slots;
}

const decodeEntities = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** True statements computed from the data: the model may only rephrase and prioritise these. */
export function facts(d: ReportData): string[] {
  const t = d.totals;
  const out = [`${t.passed} of ${t.scenarios} scenarios passed (${t.passRate}%) in ${t.features} feature files.`];
  out.push(t.failed === 0 ? 'No scenario failed.' : `${t.failed} scenarios failed.`);
  for (const f of d.features) out.push(`Feature "${f.name}" (${f.file}): ${f.passed} passed, ${f.failed} failed.`);
  for (const f of d.failures) out.push(`Failed: "${f.scenario}" at step "${f.step}" with error: ${f.error}`);
  const failingTags = d.tags.filter((x) => x.failed > 0).map((x) => x.tag);
  if (failingTags.length) out.push(`Tags with failures: ${failingTags.join(', ')}.`);
  out.push(
    d.run.model
      ? `${t.fromCache} steps ran from cached plans; ${t.fromModel} were planned by ${d.run.model}.`
      : `All ${t.steps} steps replayed from reviewed plans (no model involved in the run).`,
  );
  if (t.guardFixes) out.push(`Planning guards repaired ${t.guardFixes} model mistakes before execution.`);
  if (t.heals) out.push(`${t.heals} UI targets changed and were re-grounded (healed); review the plan diff.`);
  if (d.routines.length) out.push(`Routines used: ${d.routines.map((r) => r.file).join(', ')}.`);
  return out;
}

/** What the model sees: small, factual, no step-by-step noise. */
export function digest(d: ReportData): Record<string, unknown> {
  return {
    facts: facts(d),
    totals: { ...d.totals, durationSeconds: Math.round(d.durationMs / 1000) },
    run: d.run,
    features: d.features.map((f) => ({ name: f.name, file: f.file, passed: f.passed, failed: f.failed, tags: f.tags })),
    failures: d.failures.map((f) => ({ scenario: f.scenario, file: `${f.file}:${f.stepLine ?? f.scenarioLine ?? ''}`, step: f.step, error: f.error, routine: f.routine })),
    tags: d.tags,
    routines: d.routines.map((r) => ({ routine: r.routine, scenarios: r.scenarios })),
  };
}

/** Numbers, "quoted names" and file:line references in `text` must all come from `source`. */
export function verifyAiText(text: string, source: unknown): { ok: boolean; reason?: string } {
  const src = JSON.stringify(source);
  const srcLower = src.toLowerCase();
  const numbers = new Set((src.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  for (const n of text.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g) ?? []) {
    if (!numbers.has(Number(n))) return { ok: false, reason: `mentions ${n}, which is not in the run data` };
  }
  for (const m of text.matchAll(/"([^"]{3,})"|“([^”]{3,})”/g)) {
    const q = (m[1] ?? m[2] ?? '').toLowerCase();
    if (!srcLower.includes(q)) return { ok: false, reason: `quotes "${q}", which is not in the run data` };
  }
  for (const m of text.matchAll(/[\w./-]+\.(?:feature|routine)(?::\d+)?/g)) {
    if (!srcLower.includes(m[0].toLowerCase())) return { ok: false, reason: `refers to ${m[0]}, which is not in the run data` };
  }
  if (text.length > 1200) return { ok: false, reason: 'too long' };
  // Small multilingual models sometimes switch script mid-word (seen: "not注册d").
  const foreign = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/;
  if (foreign.test(text) && !foreign.test(src)) return { ok: false, reason: 'switches to another script' };
  return { ok: true };
}

/** Cuts a length-capped answer back to its last complete sentence. */
export function lastSentence(text: string): string {
  const t = text.trim();
  if (/[.!?]["')]?$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  return cut > 0 ? t.slice(0, cut + 1) : t;
}

/** Rejects text whose tone contradicts the outcome (alarm on a green run, all-clear on a red one). */
export function contradicts(text: string, failed: number): string | undefined {
  if (failed < 0) return undefined; // not a pass/fail text (e.g. a model comparison)
  if (failed === 0) {
    // "no risks", "without problems", "nothing broken" are fine; an un-negated alarm word is not.
    for (const m of text.matchAll(/\b(attention|investigat\w*|concern\w*|risk\w*|problem\w*|broken|regression\w*|issue\w*)\b/gi)) {
      // The sentence so far: "No user-facing behaviour is broken" negates far from the word.
      const before = text.slice(0, m.index).split(/[.!?]\s/).pop()?.toLowerCase() ?? '';
      if (!/\b(no|not|without|zero|nothing|none|any)\b[^.]*$/.test(before)) return 'raises concerns although no scenario failed';
    }
  }
  if (failed > 0 && /\b(all (scenarios |tests |checks )?passed|100\s?%|no (scenario|test|check)s? failed|no failures)\b/i.test(text)) {
    return 'claims success although scenarios failed';
  }
  // Release verdicts must match the result (seen: "The build can ship." with 2 failures).
  const shipYes = /\b(can|could|should|is ready to|ready to|safe to|good to|okay to|ok to)\s+(ship|release|go live)\b|\bready for release\b/i;
  const shipNo = /\b(cannot|can't|can not|should not|shouldn't|not ready to|not safe to|do not|don't)\s+(ship|release|go live)\b|\bnot ready\b/i;
  if (failed > 0 && shipYes.test(text.replace(shipNo, ''))) return 'says it can ship although scenarios failed';
  if (failed === 0 && shipNo.test(text)) return 'says it cannot ship although nothing failed';
  return undefined;
}

/** The template's brief: <script type="text/x-e2e-ai-brief">…</script>. */
export function templateBrief(template: string): string {
  return /<script[^>]*type="text\/x-e2e-ai-brief"[^>]*>([\s\S]*?)<\/script>/i.exec(template)?.[1]?.trim() ?? '';
}

/** Sections the template can show, in its order; `data-required` ones can never be hidden. */
export function templateSections(template: string): { name: string; required: boolean; pinned: boolean }[] {
  return [...template.matchAll(/<[a-z][\w-]*\b[^>]*\bdata-section="([\w-]+)"[^>]*>/gi)].map((m) => ({
    name: m[1] as string,
    required: /\bdata-(required|pinned)\b/.test(m[0]),
    pinned: /\bdata-pinned\b/.test(m[0]),
  }));
}

/** Pinned sections keep their template position; the model orders the rest around them. */
export function arrange(templateOrder: { name: string; pinned: boolean }[], modelOrder: string[]): string[] {
  const free = modelOrder.filter((n) => !templateOrder.some((t) => t.name === n && t.pinned));
  const out: string[] = [];
  let next = 0;
  for (const t of templateOrder) {
    if (t.pinned) out.push(t.name);
    else if (next < free.length) out.push(free[next++] as string);
  }
  return [...out, ...free.slice(next)];
}

export function templateMediaOptions(template: string): string[] {
  const m = /data-e2e-ai-media-options="([^"]*)"/.exec(template);
  return (m?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

export function templateGroupOptions(template: string): string[] {
  const m = /data-e2e-ai-group-options="([^"]*)"/.exec(template);
  return (m?.[1] ?? 'feature').split(',').map((x) => x.trim()).filter(Boolean);
}

export function defaultView(d: ReportData, template: string): ViewPlan {
  const groups = templateGroupOptions(template);
  const media = templateMediaOptions(template)[0];
  return {
    groupBy: groups[0] ?? 'feature',
    ...(media ? { media } : {}),
    sortBy: 'failed-first',
    expand: 'failed',
    sections: templateSections(template).map((x) => x.name),
    highlight: d.failures.slice(0, 5).map((f) => f.id),
    headline: d.totals.failed ? `${d.totals.failed} of ${d.totals.scenarios} scenarios failed` : `All ${d.totals.scenarios} scenarios passed`,
    accepted: false,
  };
}

/** Asks the model to fit this run's data to the template; validated, with required sections kept. */
export async function planView(d: ReportData, template: string, llm: Llm | undefined): Promise<ViewPlan> {
  const fallback = defaultView(d, template);
  if (!llm) return { ...fallback, reason: 'no pocket model: default view' };
  const sections = templateSections(template);
  const ids = d.features.flatMap((f) => f.scenarios.map((s) => (s as ScenarioReport & { id: string }).id));
  const schema = {
    type: 'object',
    properties: {
      groupBy: { type: 'string', enum: templateGroupOptions(template) },
      ...(templateMediaOptions(template).length ? { media: { type: 'string', enum: templateMediaOptions(template) } } : {}),
      sortBy: { type: 'string', enum: ['failed-first', 'file', 'name', 'slowest'] },
      expand: { type: 'string', enum: ['failed', 'all', 'none'] },
      sections: { type: 'array', items: { type: 'string', enum: sections.map((x) => x.name) }, minItems: 1 },
      highlight: { type: 'array', items: { type: 'string', enum: ids.length ? ids : ['none'] }, maxItems: 5 },
      headline: { type: 'string', maxLength: 90 },
    },
    required: ['groupBy', ...(templateMediaOptions(template).length ? ['media'] : []), 'sortBy', 'expand', 'sections', 'highlight', 'headline'],
  };
  const scenarios = d.features.flatMap((f) =>
    f.scenarios.map((s) => ({ id: (s as ScenarioReport & { id: string }).id, name: s.name, feature: f.name, status: s.status, tags: s.tags, ms: Math.round(s.ms) })),
  );
  try {
    const r = await llm.json<Omit<ViewPlan, 'accepted'>>({
      system:
        'You lay out an E2E test report. The TEMPLATE BRIEF below says who reads it and what matters to them. ' +
        'Choose how to group and sort the scenarios, which ones to expand, which sections to show in which order, ' +
        'which scenarios to highlight, and a short headline. Base the headline only on the facts.\n\nTEMPLATE BRIEF:\n' +
        (templateBrief(template) || '(none)'),
      prompt:
        `Facts: ${JSON.stringify(facts(d))}\nScenarios: ${JSON.stringify(scenarios)}\nSections available: ${sections.map((x) => x.name).join(', ')}` +
        `\nMedia collected: ${d.totals.screenshots} step screenshots, ${d.totals.videos} scenario videos.`,
      schema,
    });
    const seen = new Set<string>();
    let order = (r.sections ?? []).filter((x) => !seen.has(x) && seen.add(x));
    // Guards: required sections and (on a red run) failures can never be hidden.
    for (const sec of sections) if ((sec.required || (sec.name === 'failures' && d.failures.length)) && !order.includes(sec.name)) order.push(sec.name);
    order = arrange(sections, order.filter((x) => sections.some((s) => s.name === x)));
    const tone = contradicts(r.headline ?? '', d.totals.failed);
    const v = tone ? { ok: false, reason: tone } : verifyAiText(r.headline ?? '', { facts: facts(d), scenarios });
    // Highlights point at problems: on a green run the model's picks are dropped (seen: s1–s5 by rote).
    const highlight = d.failures.length ? (r.highlight ?? []).filter((x) => ids.includes(x)) : [];
    // A red run always highlights its failures first.
    for (const f of d.failures) if (!highlight.includes(f.id) && highlight.length < 5) highlight.unshift(f.id);
    return {
      groupBy: r.groupBy,
      ...(r.media ? { media: r.media } : {}),
      sortBy: r.sortBy,
      expand: r.expand,
      sections: order,
      highlight: [...new Set(highlight)].slice(0, 5),
      headline: v.ok ? lastSentence(r.headline) : fallback.headline,
      accepted: true,
      ...(v.ok ? {} : { reason: `headline rejected (${v.reason}); generated one used` }),
      model: llm.model,
    };
  } catch (e) {
    return { ...fallback, reason: `model error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function fallbackSummary(d: ReportData): string {
  const t = d.totals;
  const parts = [`${t.passed} of ${t.scenarios} scenarios passed (${t.passRate}%) across ${t.features} feature file(s).`];
  if (t.failed) parts.push(`${t.failed} failed: ${d.failures.map((f) => `"${f.scenario}"`).join(', ')}.`);
  parts.push(d.run.model ? `${t.fromCache} steps replayed from the plan cache, ${t.fromModel} planned by ${d.run.model}.` : `All ${t.steps} steps replayed from reviewed plans.`);
  if (t.guardFixes) parts.push(`Guards repaired ${t.guardFixes} planning issue(s).`);
  return parts.join(' ');
}

/** Share of the text's 4-word sequences that appear in `instructions` (prompt echo detector). */
export function echoRatio(text: string, instructions: string): number {
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9#@\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const w = words(text);
  if (w.length < 6) return 0;
  const inst = new Set<string>();
  const iw = words(instructions);
  for (let i = 0; i + 4 <= iw.length; i++) inst.add(iw.slice(i, i + 4).join(' '));
  let hit = 0;
  let n = 0;
  for (let i = 0; i + 4 <= w.length; i++, n++) if (inst.has(w.slice(i, i + 4).join(' '))) hit++;
  return n ? hit / n : 0;
}

/**
 * One checked paragraph: up to two attempts (the second told why the first was rejected), each
 * checked for invented numbers/names/files, a tone that contradicts the result, a foreign script,
 * and echoing its own instructions (seen: a 4B model returned the template brief as the summary).
 */
export async function checkedText(
  llm: Llm,
  opts: { task: string; brief: string; data: unknown; failed: number; maxLength: number },
): Promise<{ ok: true; text: string } | { ok: false; reason: string; text: string }> {
  const system =
    'You write one paragraph of an E2E test report, in plain English, no markdown.\n' +
    (opts.brief ? `READER (who the report is for; do NOT repeat this): ${opts.brief.replace(/\s+/g, ' ')}\n` : '') +
    `TASK: ${opts.task}\n` +
    'RULES: Write about the run in the DATA, never about the report or these instructions. Use only facts in the DATA. ' +
    'Do not invent numbers, names, files, risks or advice.';
  let reason = '';
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await llm.json<{ text: string }>({
      system,
      prompt: `DATA: ${JSON.stringify(opts.data)}` + (attempt ? `\nYour previous text was rejected because it ${reason}. Write it again, about the run.` : ''),
      schema: { type: 'object', properties: { text: { type: 'string', maxLength: opts.maxLength } }, required: ['text'] },
    });
    text = lastSentence(r.text);
    const echo = echoRatio(text, `${system}`);
    // Meta-talk: describing the report or its reader instead of the run (seen with small models).
    const meta = /\b(the|this) report (should|must|will|needs?|is for)\b|\b(product owner|reader|engineers?) (should|must|will) (see|want|get)\b/i.test(text);
    const tone = contradicts(text, opts.failed);
    const v = echo > 0.25 || meta ? { ok: false, reason: 'describes the report or its instructions instead of the run' } : tone ? { ok: false, reason: tone } : verifyAiText(text, opts.data);
    if (v.ok) return { ok: true, text };
    reason = v.reason ?? 'rejected';
  }
  return { ok: false, reason, text };
}

export async function writeAiSlots(d: ReportData, slots: AiSlot[], llm: Llm | undefined, brief = ''): Promise<void> {
  d.ai.model = llm?.model ?? null;
  const data = digest(d);
  for (const slot of slots) {
    if (slot.each === 'failure') {
      for (const f of d.failures) {
        if (!llm) {
          d.ai.failures[f.id] = { text: '', accepted: false, reason: 'no pocket model' };
          continue;
        }
        try {
          const r = await checkedText(llm, { task: `${slot.prompt} Do not repeat the error message verbatim.`, brief, data: { ...f, run: d.run }, failed: 1, maxLength: 600 });
          d.ai.failures[f.id] = r.ok
            ? { text: r.text, accepted: true, model: llm.model }
            : { text: '', accepted: false, reason: `AI text rejected: ${r.reason}`, model: llm.model, rejected: r.text };
        } catch (e) {
          d.ai.failures[f.id] = { text: '', accepted: false, reason: `model error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      continue;
    }
    const fallback = slot.name === 'summary' ? fallbackSummary(d) : '';
    if (!llm) {
      d.ai.sections[slot.name] = { text: fallback, accepted: false, reason: 'no pocket model: generated from data' };
      continue;
    }
    try {
      const r = await checkedText(llm, {
        task: `${slot.prompt} Base every sentence on the "facts" list: rephrase and prioritise them, add nothing else.`,
        brief,
        data,
        failed: d.totals.failed,
        maxLength: 900,
      });
      d.ai.sections[slot.name] = r.ok
        ? { text: r.text, accepted: true, model: llm.model }
        : { text: fallback, accepted: false, reason: `AI text rejected: ${r.reason}`, model: llm.model, rejected: r.text };
    } catch (e) {
      d.ai.sections[slot.name] = { text: fallback, accepted: false, reason: `model error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

export function renderHtml(template: string, d: ReportData): string {
  const json = JSON.stringify(d).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (!template.includes('/*__REPORT_DATA__*/null')) throw new Error('report template lacks the /*__REPORT_DATA__*/null marker');
  // Function replacements: a string replacement would interpret `$&`, `$'`… inside the data.
  return template.replace('/*__REPORT_DATA__*/null', () => json);
}

/** Regenerates index.html from an existing report.json (template iteration without re-running). */
export async function rerender(opts: { jsonPath: string; templatePath: string; llm?: Llm; outDir?: string; indexName?: string }): Promise<string> {
  const data = JSON.parse(readFileSync(opts.jsonPath, 'utf8')) as ReportData;
  return writeReport({
    templatePath: opts.templatePath,
    outDir: opts.outDir ?? dirname(opts.jsonPath),
    data,
    ...(opts.llm ? { llm: opts.llm } : {}),
    ...(opts.indexName ? { indexName: opts.indexName } : {}),
  });
}

export async function writeReport(opts: { templatePath: string; outDir: string; data: ReportData; llm?: Llm; indexName?: string }): Promise<string> {
  const template = readFileSync(opts.templatePath, 'utf8');
  opts.data.ai = { sections: {}, failures: {}, model: null, template: opts.templatePath.split('/').pop()?.replace(/\.html$/, '') ?? 'template' };
  await writeAiSlots(opts.data, findSlots(template), opts.llm, templateBrief(template));
  opts.data.ai.view = await planView(opts.data, template, opts.llm);
  const html = renderHtml(template, opts.data);
  const index = `${opts.outDir}/${opts.indexName ?? 'index.html'}`;
  mkdirSync(dirname(index), { recursive: true });
  writeFileSync(index, html);
  if ((opts.indexName ?? 'index.html') === 'index.html') writeFileSync(`${opts.outDir}/report.json`, `${JSON.stringify(opts.data, null, 2)}\n`);
  else writeFileSync(`${opts.outDir}/${(opts.indexName as string).replace(/\.html$/, '')}.ai.json`, `${JSON.stringify(opts.data.ai, null, 2)}\n`);
  return index;
}
