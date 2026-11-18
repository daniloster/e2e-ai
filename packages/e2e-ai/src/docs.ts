// Markdown docs → the app context the pocket model plans with. Developers write documentation, not
// code: an API reference (`### METHOD /path` + a `Field` table) and an app guide (Routes table,
// "Before every scenario", Glossary, Examples). Everything the model may call or open is parsed
// from these files and becomes an enum in its JSON schema — it cannot call what is not documented.
import type { AppContext, ParamSpec, PlanExample, PlannedAction, PocketFn, RouteSpec, World } from './types.ts';

export interface Endpoint {
  id: string; // "POST /__test/users", "MUTATION createNote", "RPC notes.v1.Notes/Create"
  protocol: 'rest' | 'graphql' | 'grpc';
  method: string;
  path: string;
  description: string;
  auth: boolean;
  fields: { name: string; type: ParamSpec['type']; required: boolean; description: string }[];
  source: string; // file:line
}

export interface AppGuide {
  name: string;
  description: string;
  screens: string;
  routes: Record<string, RouteSpec>;
  beforeEach: string[]; // endpoint ids
  glossary: Record<string, string>;
  examples: PlanExample[];
}

const ENDPOINT = /^#{2,4}\s+(GET|POST|PUT|PATCH|DELETE|QUERY|MUTATION|RPC)\s+(\S+)\s*$/i;

function tableRows(lines: string[]): string[][] {
  return lines
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
}

const typeOf = (t: string): ParamSpec['type'] => (/bool/i.test(t) ? 'boolean' : /int|number|float|double/i.test(t) ? 'number' : 'string');

export function parseApiDoc(md: string, file = 'api.md'): Endpoint[] {
  const lines = md.split(/\r?\n/);
  const out: Endpoint[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ENDPOINT.exec(lines[i] as string);
    if (!m) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^#{1,4}\s/.test(lines[j] as string)) body.push(lines[j++] as string);
    const verb = (m[1] as string).toUpperCase();
    const protocol = verb === 'QUERY' || verb === 'MUTATION' ? 'graphql' : verb === 'RPC' ? 'grpc' : 'rest';
    const rows = tableRows(body);
    const header = (rows[0] ?? []).map((h) => h.toLowerCase());
    const fields =
      header.includes('field')
        ? rows.slice(1).map((r) => {
            const get = (k: string) => r[header.indexOf(k)] ?? '';
            return { name: get('field'), type: typeOf(get('type')), required: /^y/i.test(get('required')), description: get('description') };
          })
        : [];
    const prose = body.filter((l) => l.trim() && !l.trim().startsWith('|') && !/^response\b/i.test(l.trim()));
    out.push({
      id: `${verb} ${m[2]}`,
      protocol,
      method: verb,
      path: m[2] as string,
      description: prose.join(' ').replace(/\*\*Auth:\s*bearer\*\*/i, '').replace(/\s+/g, ' ').trim(),
      auth: body.some((l) => /\*\*Auth:\s*bearer\*\*/i.test(l)),
      fields,
      source: `${file}:${i + 1}`,
    });
  }
  return out;
}

function sections(md: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current = '_intro';
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      current = (h[1] as string).trim().toLowerCase();
      continue;
    }
    if (/^#\s/.test(line)) continue;
    map.set(current, [...(map.get(current) ?? []), line]);
  }
  return map;
}

/** `fill Email field = "x"` / `call POST /x` / `open notes` / `expect count notes = 3` → an action. */
export function parseExampleAction(text: string): PlannedAction | undefined {
  const t = text.trim();
  const call = /^call\s+(.+)$/i.exec(t);
  if (call) return { kind: 'call', fn: (call[1] as string).trim() };
  const open = /^open\s+(\S+)$/i.exec(t);
  if (open) return { kind: 'open', route: open[1] as string };
  const m = /^(fill|tap|expect\s+visible|expect\s+hidden|expect\s+count)\s+(.*?)(?:\s*=\s*(?:"([^"]*)"|(\d+)))?$/i.exec(t);
  if (!m) return undefined;
  const verb = (m[1] as string).toLowerCase().replace(/\s+/, '_');
  const kind = (verb.startsWith('expect') ? verb : verb) as PlannedAction['kind'];
  const a: PlannedAction = { kind, target: (m[2] as string).trim() };
  if (m[3] !== undefined) a.value = m[3];
  if (m[4] !== undefined) a.count = Number(m[4]);
  return a;
}

export function parseAppGuide(md: string): AppGuide {
  const s = sections(md);
  const name = /^#\s+(.*?)(?:\s+—.*)?$/m.exec(md)?.[1]?.trim() ?? 'App';
  const intro = (s.get('_intro') ?? []).join(' ').replace(/\s+/g, ' ').trim();
  const routes: Record<string, RouteSpec> = {};
  const rows = tableRows(s.get('routes') ?? []);
  const header = (rows[0] ?? []).map((h) => h.toLowerCase());
  for (const r of rows.slice(1)) {
    const get = (k: string) => (r[header.indexOf(k)] ?? '').trim();
    const spec: RouteSpec = { description: get('description') };
    if (get('web')) spec.web = get('web');
    if (get('mobile')) spec.mobile = get('mobile');
    if (get('route')) routes[get('route')] = spec;
  }
  const beforeEach = (s.get('before every scenario') ?? [])
    .map((l) => /^\s*[-*]\s+((?:GET|POST|PUT|PATCH|DELETE)\s+\S+)/i.exec(l)?.[1])
    .filter((x): x is string => !!x);
  const glossary: Record<string, string> = {};
  for (const l of s.get('glossary') ?? []) {
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*:?\s*(.*)$/.exec(l);
    if (m) glossary[m[1] as string] = (m[2] as string).trim();
  }
  const examples: PlanExample[] = [];
  for (const l of s.get('examples') ?? []) {
    const m = /^\s*[-*]\s+(.+?)\s+(?:→|->)\s+(.+)$/.exec(l);
    if (!m) continue;
    const actions = (m[2] as string).split(';').map(parseExampleAction);
    if (actions.every((a): a is PlannedAction => !!a)) examples.push({ step: (m[1] as string).trim(), actions });
  }
  return {
    name,
    description: intro,
    screens: (s.get('screens') ?? []).join('\n').trim(),
    routes,
    beforeEach,
    glossary,
    examples,
  };
}

/** The newest value of `key` anywhere in the scenario's facts (e.g. the last login token). */
export function lookupFact(facts: Record<string, unknown>, key: string): string | undefined {
  const values = Object.values(facts);
  for (let i = values.length - 1; i >= 0; i--) {
    const found = deepFind(values[i], key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function deepFind(v: unknown, key: string): string | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (key in o && (typeof o[key] === 'string' || typeof o[key] === 'number')) return String(o[key]);
  for (const x of Object.values(o)) {
    const f = deepFind(x, key);
    if (f !== undefined) return f;
  }
  return undefined;
}

export async function callEndpoint(
  baseUrl: string,
  ep: Endpoint,
  args: Record<string, unknown>,
  world: World,
): Promise<unknown> {
  if (ep.protocol !== 'rest') throw new Error(`${ep.id}: ${ep.protocol} execution is not implemented in the spike (REST only)`);
  const rest = { ...args };
  const path = ep.path.replace(/\{(\w+)\}|:(\w+)/g, (_, a: string | undefined, b: string | undefined) => {
    const k = (a ?? b) as string;
    const v = rest[k] ?? lookupFact(world.facts, k);
    delete rest[k];
    if (v === undefined) throw new Error(`${ep.id}: no value for path parameter ${k}`);
    return encodeURIComponent(String(v));
  });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ep.auth) {
    const token = lookupFact(world.facts, 'token');
    if (!token) throw new Error(`${ep.id} needs a signed-in token; call POST /auth/login first`);
    headers.authorization = `Bearer ${token}`;
  }
  const hasBody = !['GET', 'DELETE'].includes(ep.method);
  const query = !hasBody && Object.keys(rest).length ? `?${new URLSearchParams(rest as Record<string, string>).toString()}` : '';
  const init: RequestInit = { method: ep.method, headers };
  if (hasBody) init.body = JSON.stringify(rest);
  const res = await fetch(baseUrl.replace(/\/$/, '') + path + query, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${ep.id} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Docs → AppContext: one function per endpoint, routes/glossary/examples from the guide. */
export function contextFromDocs(opts: { apiDocs: { md: string; file: string }[]; guide: { md: string; file: string }; baseUrl: string }): AppContext & {
  endpoints: Endpoint[];
} {
  const endpoints = opts.apiDocs.flatMap((d) => parseApiDoc(d.md, d.file));
  const guide = parseAppGuide(opts.guide.md);
  const data: Record<string, PocketFn> = {};
  for (const ep of endpoints) {
    const params: Record<string, ParamSpec> = {};
    for (const f of ep.fields) params[f.name] = { type: f.type, description: f.description, ...(f.required ? {} : { optional: true }) };
    data[ep.id] = {
      description: `${ep.description}${ep.auth ? ' (needs a login token)' : ''}`.trim(),
      params,
      run: async (args, { world }) => ({ request: args, response: await callEndpoint(opts.baseUrl, ep, args, world) }),
    };
  }
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  for (const id of guide.beforeEach) if (!byId.has(id)) throw new Error(`app guide: "Before every scenario" calls ${id}, which no API doc defines`);
  return {
    name: guide.name,
    description: [guide.description, guide.screens ? `Screens:\n${guide.screens}` : ''].filter(Boolean).join('\n'),
    pockets: [{ name: '', description: 'API endpoints', data, routes: guide.routes, glossary: guide.glossary, examples: guide.examples }],
    endpoints,
    async beforeScenario({ world }) {
      for (const id of guide.beforeEach) await callEndpoint(opts.baseUrl, byId.get(id) as Endpoint, {}, world);
    },
  };
}
