// Flattens an AppContext's pockets into the catalog the planner prompts with and the runner calls.
import { PLANNER_VERSION } from './planner.ts';
import type { AppContext, PlanExample, PocketFn, RouteSpec } from './types.ts';

export interface Catalog {
  fns: Record<string, PocketFn & { kind: 'data' | 'access' }>;
  routes: Record<string, RouteSpec>;
  glossary: Record<string, string>;
  examples: PlanExample[];
}

export function buildCatalog(ctx: AppContext): Catalog {
  const cat: Catalog = { fns: {}, routes: {}, glossary: {}, examples: [] };
  for (const p of ctx.pockets) {
    for (const [n, f] of Object.entries(p.data ?? {})) cat.fns[p.name ? `${p.name}.${n}` : n] = { ...f, kind: 'data' };
    for (const [n, f] of Object.entries(p.access ?? {})) cat.fns[p.name ? `${p.name}.${n}` : n] = { ...f, kind: 'access' };
    Object.assign(cat.routes, p.routes ?? {});
    Object.assign(cat.glossary, p.glossary ?? {});
    cat.examples.push(...(p.examples ?? []));
  }
  return cat;
}

/** A stable fingerprint of what the planner was shown, so cached plans expire when it changes. */
export function catalogFingerprint(cat: Catalog): string {
  return JSON.stringify({
    planner: PLANNER_VERSION,
    fns: Object.entries(cat.fns).map(([k, f]) => [k, f.description, f.params]),
    routes: cat.routes,
    glossary: cat.glossary,
  });
}

export function describeCatalog(cat: Catalog): string {
  const fns = Object.entries(cat.fns).map(([name, f]) => {
    const params = Object.entries(f.params)
      .map(([p, s]) => `${p}${s.optional ? '?' : ''}: ${s.type}${s.enum ? ` (${s.enum.join('|')})` : ''} — ${s.description}`)
      .join('; ');
    return `- ${name} [${f.kind}]: ${f.description}${params ? ` Params: ${params}` : ''}`;
  });
  const routes = Object.entries(cat.routes).map(([n, r]) => `- ${n}: ${r.description}`);
  const glossary = Object.entries(cat.glossary).map(([w, d]) => `- ${w}: ${d}`);
  return [
    'API endpoints you may call (kind "call", fn = "METHOD /path"):',
    ...(fns.length ? fns : ['- (none)']),
    'Routes (kind "open"):',
    ...(routes.length ? routes : ['- (none)']),
    ...(glossary.length ? ['Glossary:', ...glossary] : []),
  ].join('\n');
}
