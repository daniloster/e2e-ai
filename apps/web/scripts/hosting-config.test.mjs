// @vitest-environment node
// Pins the Cloudflare hosting configuration invariants.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { toCloudflarePattern, toHeaderRules } from './write-hosting-files.mjs';

const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));
const WRANGLER_JSON = fileURLToPath(new URL('../wrangler.json', import.meta.url));
const FIREBASE_JSON = fileURLToPath(new URL('../firebase.json', import.meta.url));
const GITIGNORE = fileURLToPath(new URL('../../../.gitignore', import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Assets only: no `main`, so no Worker script ever runs. Production is the apex custom
// domain; www is attached only so a Redirect Rule can send it to the apex.
const TOP_LEVEL_KEYS = [
  '$schema',
  'name',
  'compatibility_date',
  'assets',
  'routes',
  'workers_dev',
  'preview_urls',
];
const EXPECTED_ROUTES = [
  { pattern: 'pocketnotes.app', custom_domain: true },
  { pattern: 'www.pocketnotes.app', custom_domain: true },
];
const ROUTE_KEYS = ['pattern', 'custom_domain'];
const ASSETS_KEYS = ['directory', 'not_found_handling', 'html_handling'];
const EXPECTED = {
  name: 'pocket-notes',
  compatibility_date: '2026-10-01',
  workers_dev: false,
  preview_urls: false,
};
const EXPECTED_ASSETS = {
  directory: './dist',
  not_found_handling: '404-page',
  html_handling: 'auto-trailing-slash',
};

/** @param {Record<string, unknown>} config  @returns {string[]} one message per violated invariant. */
function wranglerConfigProblems(config) {
  const problems = [];
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.includes(key)) problems.push(`unexpected key ${key}`);
  }
  if (config.$schema !== '../../node_modules/wrangler/config-schema.json') {
    problems.push(`$schema is ${JSON.stringify(config.$schema)}`);
  }
  for (const [key, value] of Object.entries(EXPECTED)) {
    if (config[key] !== value) problems.push(`${key} is ${JSON.stringify(config[key])}`);
  }
  const routes = Array.isArray(config.routes) ? config.routes : [];
  for (const route of routes) {
    for (const key of Object.keys(route)) {
      if (!ROUTE_KEYS.includes(key))
        problems.push(`unexpected key ${key} in route ${route.pattern}`);
    }
    if (route.custom_domain !== true) {
      problems.push(
        `route ${route.pattern} has custom_domain ${JSON.stringify(route.custom_domain)}`,
      );
    }
  }
  const patterns = routes.map((route) => route.pattern);
  if (JSON.stringify(patterns) !== JSON.stringify(EXPECTED_ROUTES.map((r) => r.pattern))) {
    problems.push(`routes are ${JSON.stringify(patterns)}`);
  }
  const assets = config.assets;
  if (typeof assets !== 'object' || assets === null) return [...problems, 'assets is missing'];
  for (const key of Object.keys(assets)) {
    if (!ASSETS_KEYS.includes(key)) problems.push(`unexpected key assets.${key}`);
  }
  for (const [key, value] of Object.entries(EXPECTED_ASSETS)) {
    if (assets[key] !== value) problems.push(`assets.${key} is ${JSON.stringify(assets[key])}`);
  }
  return problems;
}

describe('wrangler.json', () => {
  const config = readJson(WRANGLER_JSON);

  it('is an assets-only Worker on the production custom domains', () => {
    expect(wranglerConfigProblems(config)).toEqual([]);
  });

  it('flags a Worker script', () => {
    const problems = wranglerConfigProblems({ ...structuredClone(config), main: 'src/index.ts' });
    expect(problems.some((p) => p.includes('main'))).toBe(true);
  });

  it('flags the SPA fallback instead of a 404 page', () => {
    const changed = structuredClone(config);
    changed.assets.not_found_handling = 'single-page-application';
    const problems = wranglerConfigProblems(changed);
    expect(problems.some((p) => p.includes('not_found_handling'))).toBe(true);
  });

  it('flags the workers.dev origin turned back on', () => {
    const problems = wranglerConfigProblems({ ...structuredClone(config), workers_dev: true });
    expect(problems.some((p) => p.includes('workers_dev'))).toBe(true);
  });

  it('flags a missing or extra route', () => {
    const withoutWww = structuredClone(config);
    withoutWww.routes.pop();
    expect(wranglerConfigProblems(withoutWww).some((p) => p.includes('routes'))).toBe(true);
    const extra = structuredClone(config);
    extra.routes.push({ pattern: 'other.example', custom_domain: true });
    expect(wranglerConfigProblems(extra).some((p) => p.includes('routes'))).toBe(true);
  });

  it('flags a route that is not a custom domain or has other keys', () => {
    const notCustom = structuredClone(config);
    notCustom.routes[0].custom_domain = false;
    expect(wranglerConfigProblems(notCustom).some((p) => p.includes('custom_domain'))).toBe(true);
    const zoned = structuredClone(config);
    zoned.routes[0].zone_name = 'pocketnotes.app';
    expect(wranglerConfigProblems(zoned).some((p) => p.includes('zone_name'))).toBe(true);
  });

  it('flags a singular route key', () => {
    const problems = wranglerConfigProblems({ ...structuredClone(config), route: 'x.example/*' });
    expect(problems.some((p) => p.includes('route'))).toBe(true);
  });

  it('points $schema at the installed Wrangler schema', () => {
    expect(existsSync(resolve(dirname(WRANGLER_JSON), config.$schema))).toBe(true);
  });
});

// Site cache rules : HTML and text revalidate within 5 minutes, /site/ assets
// (stable, unhashed URLs) within a day; none sets the CSP of the catch-all rule or X-Robots-Tag.
const SITE_HTML_CACHE = 'public,max-age=300';
const SITE_CACHE_RULES = [
  ['/', SITE_HTML_CACHE],
  ['/index.html', SITE_HTML_CACHE],
  ['/faq', SITE_HTML_CACHE],
  ['/contact', SITE_HTML_CACHE],
  ['/support', SITE_HTML_CACHE],
  ['/your-data', SITE_HTML_CACHE],
  ['/es/**', SITE_HTML_CACHE],
  ['/pt-br/**', SITE_HTML_CACHE],
  ['/sitemap.xml', SITE_HTML_CACHE],
  ['/robots.txt', SITE_HTML_CACHE],
  ['/site/**', 'public,max-age=86400'],
];
const SITE_NEW_SOURCES = SITE_CACHE_RULES.slice(2).map(([source]) => source);
const NOINDEX = { key: 'X-Robots-Tag', value: 'noindex' };
// The /get noindex rules : right after /site/** and before **.
const GET_NOINDEX_RULES = [
  ['/get', [NOINDEX, { key: 'Cache-Control', value: SITE_HTML_CACHE }]],
  ['/es/get', [NOINDEX]],
  ['/pt-br/get', [NOINDEX]],
  ['/s', [NOINDEX, { key: 'Cache-Control', value: SITE_HTML_CACHE }]],
  ['/es/s', [NOINDEX]],
  ['/pt-br/s', [NOINDEX]],
];
// The app-link association files follow the noindex rules (served as JSON).
const WELL_KNOWN_RULES = 2;

/** @param {{ headers: { source: string, headers: { key: string, value: string }[] }[] }} hosting */
function siteCacheProblems(hosting) {
  const problems = [];
  const sources = hosting.headers.map((r) => r.source);
  for (const [source, value] of SITE_CACHE_RULES) {
    const rule = hosting.headers.find((r) => r.source === source);
    if (rule === undefined) {
      problems.push(`${source} has no rule`);
      continue;
    }
    const keys = rule.headers.map((h) => h.key);
    if (JSON.stringify(rule.headers) !== JSON.stringify([{ key: 'Cache-Control', value }])) {
      problems.push(`${source} sets ${keys.join(', ')} instead of Cache-Control: ${value} alone`);
    }
  }
  const after404 = sources.indexOf('/404.html');
  const catchAll = sources.indexOf('**');
  const positions = SITE_NEW_SOURCES.map((source) => sources.indexOf(source));
  const expected = SITE_NEW_SOURCES.map((_, i) => after404 + 1 + i);
  if (
    JSON.stringify(positions) !== JSON.stringify(expected) ||
    catchAll !==
      after404 + 1 + SITE_NEW_SOURCES.length + GET_NOINDEX_RULES.length + WELL_KNOWN_RULES
  ) {
    problems.push(`site rules are not right after /404.html and before **: ${positions}`);
  }
  try {
    const rules = toHeaderRules(hosting);
    const sitePatterns = SITE_CACHE_RULES.map(([source]) => toCloudflarePattern(source));
    for (const rule of rules) {
      const csp = rule.headers.some((h) => h.name === 'Content-Security-Policy');
      if (sitePatterns.includes(rule.pattern) && csp) problems.push(`${rule.pattern} sets the CSP`);
      if (rule.pattern === '/*' && !csp) problems.push('/* lost the CSP');
    }
  } catch (error) {
    problems.push(`toHeaderRules: ${error.message}`);
  }
  return problems;
}

describe('firebase.json site cache rules', () => {
  const { hosting } = readJson(FIREBASE_JSON);

  it('caches the site pages, sitemap, robots.txt and /site/ assets, after /404.html and before **', () => {
    expect(siteCacheProblems(hosting)).toEqual([]);
  });

  it('translates to Cloudflare without an overlap, the CSP on /* only', () => {
    const rules = toHeaderRules(hosting);
    const csp = rules.filter((r) => r.headers.some((h) => h.name === 'Content-Security-Policy'));
    expect(csp.map((r) => r.pattern)).toEqual(['/*']);
    for (const pattern of ['/es/*', '/pt-br/*', '/site/*']) {
      expect(rules.find((r) => r.pattern === pattern)?.headers).toHaveLength(1);
    }
  });

  it('fails when a site rule also sets the CSP', () => {
    const copy = structuredClone(hosting);
    const site = copy.headers.find((r) => r.source === '/site/**');
    site.headers.push({ key: 'Content-Security-Policy', value: "default-src 'self'" });
    const problems = siteCacheProblems(copy);
    expect(problems).toContain(
      '/site/** sets Cache-Control, Content-Security-Policy instead of Cache-Control: public,max-age=86400 alone',
    );
    expect(problems.some((p) => p.startsWith('toHeaderRules: Content-Security-Policy'))).toBe(true);
  });

  it('fails when a rule is missing or out of place', () => {
    const copy = structuredClone(hosting);
    copy.headers = copy.headers.filter((r) => r.source !== '/faq');
    expect(siteCacheProblems(copy)).toContain('/faq has no rule');
  });
});

/** @param {{ headers: { source: string, headers: { key: string, value: string }[] }[] }} hosting */
function getNoindexProblems(hosting) {
  const problems = [];
  const sources = hosting.headers.map((r) => r.source);
  const afterSite = sources.indexOf('/site/**');
  GET_NOINDEX_RULES.forEach(([source, headers], i) => {
    const index = sources.indexOf(source);
    if (index === -1) {
      problems.push(`${source} has no rule`);
      return;
    }
    if (index !== afterSite + 1 + i) problems.push(`${source} is not right after /site/**`);
    if (JSON.stringify(hosting.headers[index].headers) !== JSON.stringify(headers)) {
      problems.push(
        `${source} sets ${hosting.headers[index].headers.map((h) => h.key).join(', ')}`,
      );
    }
  });
  if (sources.indexOf('**') !== afterSite + 1 + GET_NOINDEX_RULES.length + WELL_KNOWN_RULES) {
    problems.push('** is not right after the /get rules');
  }
  try {
    const rules = toHeaderRules(hosting);
    const csp = rules.filter((r) => r.headers.some((h) => h.name === 'Content-Security-Policy'));
    if (JSON.stringify(csp.map((r) => r.pattern)) !== JSON.stringify(['/*'])) {
      problems.push(`the CSP is on ${csp.map((r) => r.pattern).join(', ')}`);
    }
  } catch (error) {
    problems.push(`toHeaderRules: ${error.message}`);
  }
  return problems;
}

describe('firebase.json /get noindex rules', () => {
  const { hosting } = readJson(FIREBASE_JSON);

  it('marks /get, /es/get and /pt-br/get noindex, after /site/** and before **', () => {
    expect(getNoindexProblems(hosting)).toEqual([]);
  });

  it('translates to Cloudflare without an overlap', () => {
    expect(() => toHeaderRules(hosting)).not.toThrow();
    const rules = toHeaderRules(hosting);
    expect(rules.find((r) => r.pattern === '/es/get')?.headers).toEqual([
      { name: 'X-Robots-Tag', value: 'noindex' },
    ]);
  });

  it('fails when a locale /get rule also sets Cache-Control (it overlaps /es/**)', () => {
    const copy = structuredClone(hosting);
    copy.headers
      .find((r) => r.source === '/es/get')
      .headers.push({ key: 'Cache-Control', value: SITE_HTML_CACHE });
    const problems = getNoindexProblems(copy);
    expect(problems).toContain('/es/get sets X-Robots-Tag, Cache-Control');
    expect(problems.some((p) => p.startsWith('toHeaderRules:'))).toBe(true);
  });

  it('fails when a /get rule sets the CSP or is missing', () => {
    const copy = structuredClone(hosting);
    copy.headers
      .find((r) => r.source === '/get')
      .headers.push({ key: 'Content-Security-Policy', value: "default-src 'self'" });
    expect(getNoindexProblems(copy)).toContain(
      '/get sets X-Robots-Tag, Cache-Control, Content-Security-Policy',
    );
    const missing = structuredClone(hosting);
    missing.headers = missing.headers.filter((r) => r.source !== '/pt-br/get');
    expect(getNoindexProblems(missing)).toContain('/pt-br/get has no rule');
  });
});

describe('firebase.json security headers', () => {
  const { hosting } = readJson(FIREBASE_JSON);
  const catchAll = hosting.headers.find((r) => r.source === '**');
  const header = (key) => catchAll.headers.find((h) => h.key === key)?.value;

  it('sends HSTS, nosniff, a referrer policy and a permissions policy on every response', () => {
    expect(header('Strict-Transport-Security')).toMatch(/^max-age=\d{8,}/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toContain('camera=()');
  });

  it('forbids framing, plugins and foreign form targets, and opens no WebSocket', () => {
    const csp = header('Content-Security-Policy');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain('wss:');
  });
});

describe('wrangler dependency', () => {
  const pkg = readJson(PACKAGE_JSON);

  it('is pinned at exactly 4.145.0', () => {
    expect(pkg.devDependencies.wrangler).toBe('4.145.0');
  });

  it('keeps every version exact, workspace links aside', () => {
    const versions = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(versions)) {
      if (version === '*') continue;
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('deploy scripts', () => {
  const { scripts } = readJson(PACKAGE_JSON);

  it('has no ambiguous deploy', () => {
    expect(scripts.deploy).toBeUndefined();
  });

  it('builds, then deploys to Cloudflare; no development deploy remains', () => {
    expect(scripts['deploy:prod']).toBe('npm run build && wrangler deploy');
    expect(scripts['deploy:dev']).toBeUndefined();
    expect(Object.values(scripts).some((script) => script.includes('firebase deploy'))).toBe(false);
  });
});

describe('.gitignore', () => {
  it('ignores the local Wrangler state', () => {
    const lines = readFileSync(GITIGNORE, 'utf8').split('\n');
    expect(lines.some((line) => line.trim() === '.wrangler/')).toBe(true);
  });
});
