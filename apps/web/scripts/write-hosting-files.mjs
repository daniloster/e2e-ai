// Post-build step: firebase.json hosting headers -> Cloudflare dist/_headers + dist/.assetsignore.
// firebase.json is the single source of the response headers; nothing is served by
// Firebase Hosting any more (the development site was taken down on 2026-10-21).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {{ headers?: { source?: string; regex?: string; headers: { key: string; value: string }[] }[] }} FirebaseHosting */
/** @typedef {{ pattern: string; headers: { name: string; value: string }[] }} HeaderRule */

/** A firebase.json rule Cloudflare cannot express exactly, or an output limit exceeded. */
export class HostingFilesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostingFilesError';
  }
}

/** Headers refused on the catch-all source: X-Robots-Tag there would de-index every page. */
export const CATCH_ALL_FORBIDDEN_HEADERS = Object.freeze(['X-Robots-Tag']);

/** Sources that match every path. */
export const CATCH_ALL_SOURCES = Object.freeze(['**', '/**']);

// Firebase glob syntax, Cloudflare placeholders (':') and whitespace: none may appear in a literal.
const NOT_LITERAL = /[*?[\]{}!()+@:\s]/;

function isLiteralPath(path) {
  return path.startsWith('/') && !NOT_LITERAL.test(path);
}

/**
 * Translates one firebase.json `source` into a Cloudflare pattern, by an allow-list of shapes: a
 * rule that silently matched nothing on Cloudflare would fail open, so anything else throws.
 * @param {unknown} source
 * @returns {string}
 */
export function toCloudflarePattern(source) {
  if (typeof source !== 'string') {
    throw new HostingFilesError(`unsupported source ${JSON.stringify(source)} (not a string)`);
  }
  if (source === '**' || source === '/**') return '/*';
  if (source.endsWith('/**') && isLiteralPath(source.slice(0, -3))) {
    return `${source.slice(0, -2)}*`;
  }
  if (isLiteralPath(source)) return source;
  throw new HostingFilesError(`unsupported source "${source}"`);
}

function isForbiddenOnCatchAll(name) {
  return CATCH_ALL_FORBIDDEN_HEADERS.some((h) => h.toLowerCase() === name.toLowerCase());
}

// Whether the splat pattern (ending in "/*") also matches `pattern` on Cloudflare.
function splatMatches(splat, pattern) {
  const prefix = splat.slice(0, -1);
  return pattern.startsWith(prefix) || pattern === prefix.slice(0, -1);
}

// Cloudflare comma-joins a header set by two matching rules, so a shared name is an error.
function assertNoOverlap(rules) {
  for (const [i, a] of rules.entries()) {
    for (const [j, b] of rules.entries()) {
      if (i === j) continue;
      const overlaps =
        a.pattern === b.pattern
          ? i < j
          : a.pattern.endsWith('/*') && splatMatches(a.pattern, b.pattern);
      if (!overlaps) continue;
      for (const { name } of a.headers) {
        if (b.headers.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
          throw new HostingFilesError(
            `${name} is set by both "${a.pattern}" and "${b.pattern}" (Cloudflare would join them)`,
          );
        }
      }
    }
  }
}

/**
 * firebase.json hosting -> Cloudflare rules, in source order; rules without headers are dropped,
 * and a forbidden header on the catch-all rule throws.
 * @param {FirebaseHosting} hosting
 * @returns {HeaderRule[]}
 */
export function toHeaderRules(hosting) {
  const rules = [];
  for (const rule of hosting.headers ?? []) {
    if ('regex' in rule) {
      throw new HostingFilesError(`unsupported rule with regex ${JSON.stringify(rule.regex)}`);
    }
    if (!('source' in rule)) throw new HostingFilesError('unsupported rule without a source');
    const pattern = toCloudflarePattern(rule.source);
    const catchAll = CATCH_ALL_SOURCES.includes(rule.source);
    const headers = [];
    for (const { key, value } of rule.headers) {
      if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
        throw new HostingFilesError(
          `header ${JSON.stringify(key)} on "${pattern}" has a line break`,
        );
      }
      if (catchAll && isForbiddenOnCatchAll(key)) {
        throw new HostingFilesError(`${key} on "${pattern}" would apply to every page`);
      }
      headers.push({ name: key, value });
    }
    if (headers.length > 0) rules.push({ pattern, headers });
  }
  assertNoOverlap(rules);
  return rules;
}

/** Kept off Cloudflare: source maps. `_headers` is not listed. */
export const ASSETS_IGNORE = '*.map\n';

const MAX_RULES = 100;
const MAX_LINE = 2000;

/**
 * Rules -> `_headers` text: the pattern, then one indented `Name: value` line per header, rules
 * separated by a blank line. Throws on more than 100 rules or a line over 2,000 characters.
 * @param {HeaderRule[]} rules
 * @returns {string}
 */
export function formatHeaders(rules) {
  if (rules.length > MAX_RULES) {
    throw new HostingFilesError(`${rules.length} rules, Cloudflare allows ${MAX_RULES}`);
  }
  const blocks = rules.map(({ pattern, headers }) => {
    const lines = [pattern, ...headers.map(({ name, value }) => `  ${name}: ${value}`)];
    for (const line of lines) {
      if (line.length > MAX_LINE) {
        throw new HostingFilesError(
          `a line of "${pattern}" has ${line.length} characters, Cloudflare allows ${MAX_LINE}`,
        );
      }
    }
    return `${lines.join('\n')}\n`;
  });
  return blocks.join('\n');
}

/**
 * Reads firebase.json, computes both files, then writes distDir/_headers and
 * distDir/.assetsignore, so a throw leaves distDir untouched.
 * @param {{ distDir: string; firebaseJsonPath: string }} options
 * @returns {{ ruleCount: number }}
 */
export function writeHostingFiles({ distDir, firebaseJsonPath }) {
  const config = JSON.parse(readFileSync(firebaseJsonPath, 'utf8'));
  const hosting = config?.hosting;
  if (typeof hosting !== 'object' || hosting === null || Array.isArray(hosting)) {
    throw new HostingFilesError(`${firebaseJsonPath} has no hosting object`);
  }
  const rules = toHeaderRules(hosting);
  const headersText = formatHeaders(rules);
  if (!existsSync(distDir)) throw new HostingFilesError(`${distDir} does not exist`);
  writeFileSync(join(distDir, '_headers'), headersText, 'utf8');
  writeFileSync(join(distDir, '.assetsignore'), ASSETS_IGNORE, 'utf8');
  return { ruleCount: rules.length };
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const distDir = argValue(args, '--dist') ?? fileURLToPath(new URL('../dist', import.meta.url));
  const firebaseJsonPath =
    argValue(args, '--firebase') ?? fileURLToPath(new URL('../firebase.json', import.meta.url));
  try {
    const { ruleCount } = writeHostingFiles({ distDir, firebaseJsonPath });
    console.log(`write-hosting-files: OK (${ruleCount} rules)`);
  } catch (error) {
    console.error(`write-hosting-files: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
