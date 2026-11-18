// Post-build weight budget for the site pages and screenshots. Reads
// dist/site-pages.json (written by the sitePages() plugin), follows each page's static JS module
// graph and fails on a page over 30 kB of gzipped JS or 60 kB of HTML, or a screenshot over 250 kB.
// It widens the in-build check of vite/sitePages.ts (HTML-named scripts only), which stays.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** @typedef {{ file: string; kind: 'js' | 'html' | 'image'; bytes: number; gzipBytes?: number; limit: number }} BudgetItem */
/** @typedef {{ path: string; file: string; url: string; lang: string; page: string }} SitePageEntry */

export const BUDGET = Object.freeze({ jsPerPageGzip: 30_720, htmlPerPage: 61_440, image: 256_000 });

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']);
const SCREENS_DIR = 'site/screens';

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
const LINK_TAG = /<link\b[^>]*>/giu;
// Static import / export ... from specifiers in minified output; `import(` never matches.
const STATIC_IMPORT =
  /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/gu;

/**
 * A structural problem of the built dist (missing manifest or file); a plain Error named BudgetError.
 * @param {string} message
 * @returns {Error}
 */
export function budgetError(message) {
  const error = new Error(message);
  error.name = 'BudgetError';
  return error;
}

function attr(tag, name) {
  return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'iu').exec(tag)?.[1];
}

function stripQuery(url) {
  return url.replace(/[?#].*$/u, '');
}

function isSameOriginRoot(url) {
  return url.startsWith('/') && !url.startsWith('//');
}

// dist-relative POSIX path of a file inside distDir, or a BudgetError when it escapes distDir.
function insideDist(distDir, file, context) {
  const rel = relative(distDir, resolve(distDir, file));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw budgetError(`${context}: "${file}" is outside ${distDir}`);
  }
  return rel.split(/[\\/]/u).join('/');
}

/** @returns {{ entries: string[]; inline: string[] }} */
function pageScripts(html) {
  const entries = new Set();
  const inline = [];
  for (const [, attrs = '', body = ''] of html.matchAll(SCRIPT_TAG)) {
    if (attr(` ${attrs}`, 'type') !== 'module') continue;
    const src = attr(` ${attrs}`, 'src');
    if (src === undefined) inline.push(body);
    else if (isSameOriginRoot(src)) entries.add(stripQuery(src));
  }
  for (const [tag] of html.matchAll(LINK_TAG)) {
    const href = attr(tag, 'href');
    if (attr(tag, 'rel') === 'modulepreload' && href !== undefined && isSameOriginRoot(href)) {
      entries.add(stripQuery(href));
    }
  }
  return { entries: [...entries], inline };
}

// Relative or root specifiers resolved to dist-relative POSIX paths; bare, http(s): and data: are skipped.
function staticImports(code, importer) {
  const out = [];
  for (const [, specifier = ''] of code.matchAll(STATIC_IMPORT)) {
    const clean = stripQuery(specifier);
    if (clean.startsWith('./') || clean.startsWith('../')) {
      out.push(posix.normalize(posix.join(posix.dirname(importer), clean)));
    } else if (isSameOriginRoot(clean)) {
      out.push(posix.normalize(clean.slice(1)));
    }
  }
  return out;
}

/** @returns {BudgetItem} */
function jsItem(distDir, file, html) {
  const { entries, inline } = pageScripts(html);
  let bytes = 0;
  let gzipBytes = 0;
  for (const code of inline) {
    bytes += Buffer.byteLength(code);
    gzipBytes += gzipSync(code).length;
  }
  const seen = new Set();
  const queue = entries.map((url) => insideDist(distDir, url.slice(1), file));
  while (queue.length > 0) {
    const rel = queue.shift();
    if (rel === undefined || seen.has(rel)) continue;
    seen.add(rel);
    const path = join(distDir, rel);
    if (!existsSync(path)) throw budgetError(`${file}: missing script /${rel}`);
    const content = readFileSync(path);
    bytes += content.length;
    gzipBytes += gzipSync(content).length;
    for (const next of staticImports(content.toString('utf8'), rel)) {
      queue.push(insideDist(distDir, next, `${file}: /${rel}`));
    }
  }
  return { file, kind: 'js', bytes, gzipBytes, limit: BUDGET.jsPerPageGzip };
}

/** @returns {SitePageEntry[]} */
function readManifest(distDir) {
  const manifestFile = join(distDir, 'site-pages.json');
  if (!existsSync(manifestFile)) throw budgetError(`${manifestFile} is missing`);
  const entries = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw budgetError(`${manifestFile} must be a non-empty array`);
  }
  return entries;
}

/**
 * Per manifest entry: an html item then a js item (transitive static graph); then one image item
 * per dist/site/screens image, sorted by name. Throws a BudgetError on a structural problem.
 * @param {string} distDir
 * @returns {BudgetItem[]}
 */
export function checkBudget(distDir) {
  const dist = resolve(distDir);
  /** @type {BudgetItem[]} */
  const items = [];
  for (const entry of readManifest(dist)) {
    const file = insideDist(dist, String(entry?.file ?? ''), 'site-pages.json');
    const path = join(dist, file);
    if (!existsSync(path)) throw budgetError(`site-pages.json: ${file} is missing`);
    const html = readFileSync(path);
    items.push({ file, kind: 'html', bytes: html.length, limit: BUDGET.htmlPerPage });
    items.push(jsItem(dist, file, html.toString('utf8')));
  }
  const screens = join(dist, SCREENS_DIR);
  if (existsSync(screens)) {
    const names = readdirSync(screens)
      .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
      .sort();
    for (const name of names) {
      const bytes = statSync(join(screens, name)).size;
      items.push({ file: `${SCREENS_DIR}/${name}`, kind: 'image', bytes, limit: BUDGET.image });
    }
  }
  return items;
}

function measured(item) {
  return item.kind === 'js' ? (item.gzipBytes ?? 0) : item.bytes;
}

/**
 * @param {readonly BudgetItem[]} items
 * @returns {BudgetItem[]} the items over their limit
 */
export function budgetFailures(items) {
  return items.filter((item) => measured(item) > item.limit);
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1);
}

/**
 * 'PASS js index.html 12.3 kB / 30.0 kB'
 * @param {BudgetItem} item
 * @returns {string}
 */
export function formatItem(item) {
  const verdict = measured(item) > item.limit ? 'FAIL' : 'PASS';
  return `${verdict} ${item.kind} ${item.file} ${kb(measured(item))} kB / ${kb(item.limit)} kB`;
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const distDir = resolve(
    argValue(args, '--dist') ?? fileURLToPath(new URL('../dist', import.meta.url)),
  );
  try {
    const items = checkBudget(distDir);
    for (const item of items) console.log(`site-budget: ${formatItem(item)}`);
    const failures = budgetFailures(items);
    if (failures.length === 0) {
      console.log(`site-budget: OK (${items.length} checks)`);
    } else {
      console.error(`site-budget: FAIL (${failures.length} of ${items.length} over budget)`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`site-budget: FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
