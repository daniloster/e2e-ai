// The sitePages() plugin: prerenders every site page x locale into dist/ at build
// time from the SSR entry src/site/server.tsx, and renders the same pages per request in vite dev.
// Hooks stay thin; the logic is in the exported helpers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { createServer, type Connect, type Plugin, type ViteDevServer } from 'vite';
import type { Locale } from '@pn/i18n';

import {
  SITE_ORIGIN,
  localeOfPath,
  pageOutPath,
  pagePath,
  pathLocaleOf,
} from '../src/site/config.ts';
import type { RenderedPage } from '../src/site/server.tsx';
import { HTML_ENTRIES, SITE_TEMPLATE_KEYS } from './htmlEntries.ts';

export interface SiteModule {
  renderSite(): readonly RenderedPage[];
  sitemapXml(): string;
  robotsTxt(): string;
  siteTokensCss(): string;
}

const SITE_ENTRY = '/src/site/server.tsx';
// The legal pages' token stylesheet, generated: never committed under public/.
export const SITE_TOKENS_PATH = 'site/tokens.css';
export const SITE_JS_BUDGET_BYTES = 30 * 1024;

const HEAD_MARKER = '<!--site-head-->';
const BODY_MARKER = '<!--site-body-->';
const HTML_LANG = /<html\b([^>]*?)\blang="[^"]*"([^>]*)>/u;
const SITE_PAGE_ATTR = /\s+data-site-page="[^"]*"/gu;

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function replaceMarker(template: string, marker: string, value: string, name: string): string {
  const n = occurrences(template, marker);
  if (n !== 1) {
    throw new Error(`site-pages: ${name} must contain ${marker} exactly once (found ${n})`);
  }
  // A function replacement keeps $& and $1 in the rendered text literal.
  return template.replace(marker, () => value);
}

// <html lang>, <!--site-head-->, <!--site-body--> (exactly once each), else Error naming templateName.
export function injectPage(
  template: string,
  page: Pick<RenderedPage, 'lang' | 'head' | 'body'> & Partial<Pick<RenderedPage, 'sitePage'>>,
  templateName: string,
): string {
  if (!HTML_LANG.test(template)) {
    throw new Error(`site-pages: ${templateName} has no <html lang="..."> start tag`);
  }
  const { sitePage } = page;
  const withLang = template.replace(HTML_LANG, (_match, before: string, after: string) =>
    sitePage === undefined
      ? `<html${before}lang="${page.lang}"${after}>`
      : `<html${before.replace(SITE_PAGE_ATTR, '')}lang="${page.lang}" data-site-page="${sitePage}"${after.replace(SITE_PAGE_ATTR, '')}>`,
  );
  const withHead = replaceMarker(withLang, HEAD_MARKER, page.head, templateName);
  return replaceMarker(withHead, BODY_MARKER, page.body, templateName);
}

function assertOutPath(outPath: string): void {
  const unsafe =
    isAbsolute(outPath) || outPath.split(/[\\/]/u).includes('..') || !outPath.endsWith('.html');
  if (unsafe) throw new Error(`site-pages: unsafe out path "${outPath}"`);
}

const MODULE_SCRIPT = /<script\b[^>]*>/giu;
const MODULE_PRELOAD = /<link\b[^>]*>/giu;

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`, 'iu').exec(tag)?.[1];
}

// Same-origin module scripts and modulepreloads of a page, as root-relative paths without query.
function scriptUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const [tag] of html.matchAll(MODULE_SCRIPT)) {
    if (attr(tag, 'type') === 'module') urls.add(attr(tag, 'src') ?? '');
  }
  for (const [tag] of html.matchAll(MODULE_PRELOAD)) {
    if (attr(tag, 'rel') === 'modulepreload') urls.add(attr(tag, 'href') ?? '');
  }
  return [...urls]
    .filter((url) => url.startsWith('/') && !url.startsWith('//'))
    .map((url) => url.replace(/[?#].*$/u, ''));
}

// gzip total of same-origin module scripts and modulepreloads in html; [] when within limit.
export function scriptBudgetProblems(
  distDir: string,
  html: string,
  limit: number = SITE_JS_BUDGET_BYTES,
): string[] {
  const problems: string[] = [];
  const sizes: string[] = [];
  let total = 0;
  for (const url of scriptUrls(html)) {
    const file = join(distDir, url);
    if (!existsSync(file)) {
      problems.push(`missing script ${url}`);
      continue;
    }
    const size = gzipSync(readFileSync(file)).length;
    total += size;
    sizes.push(`${url} ${size} B`);
  }
  if (total > limit) {
    problems.push(`JS ${total} B gzip exceeds ${limit} B (${sizes.join(', ')})`);
  }
  return problems;
}

// One written page, for the build budget script and the site smoke (e2e/site.spec.ts): neither imports src/.
export interface SitePageEntry {
  path: string;
  file: string;
  url: string;
  lang: Locale;
  page: string;
}

// 'index.html' -> '/', 'es/index.html' -> '/es/', 'rules.html' -> '/rules', 'pt-br/get.html' -> '/pt-br/get'.
export function urlPathOf(outPath: string): string {
  if (!outPath.endsWith('.html')) throw new Error(`site-pages: out path "${outPath}" is not .html`);
  const path = `/${outPath.slice(0, -'.html'.length)}`;
  return path === '/index' ? '/' : path.replace(/\/index$/u, '/');
}

// renderSite() order; url = SITE_ORIGIN + path; page = sitePage.
export function siteManifest(pages: readonly RenderedPage[]): SitePageEntry[] {
  return pages.map((page) => {
    const path = urlPathOf(page.outPath);
    return {
      path,
      file: page.outPath,
      url: `${SITE_ORIGIN}${path}`,
      lang: page.lang,
      page: page.sitePage,
    };
  });
}

// Read every template, validate out paths, check the JS budget, then write pages + sitemap.xml +
// robots.txt + site/tokens.css + site-pages.json.
export function writeSiteFiles(distDir: string, site: SiteModule): { pages: number } {
  const tokensFile = join(distDir, SITE_TOKENS_PATH);
  if (existsSync(tokensFile)) {
    throw new Error(
      `site-pages: ${SITE_TOKENS_PATH} is generated; delete apps/web/public/${SITE_TOKENS_PATH}`,
    );
  }
  const pages = site.renderSite();
  for (const page of pages) assertOutPath(page.outPath);
  // All templates are read first: the en home's out path is its own template (index.html).
  const templates = new Map<string, string>();
  for (const name of new Set(pages.map((p) => p.template))) {
    const file = join(distDir, name);
    if (!existsSync(file)) throw new Error(`site-pages: template ${name} is missing in ${distDir}`);
    templates.set(name, readFileSync(file, 'utf8'));
  }
  const outputs = pages.map((page) => {
    const html = injectPage(templates.get(page.template) ?? '', page, page.template);
    const problems = scriptBudgetProblems(distDir, html);
    if (problems.length > 0) {
      throw new Error(`site-pages: ${page.outPath}: ${problems.join('; ')}`);
    }
    return { file: join(distDir, page.outPath), html };
  });
  outputs.push(
    { file: join(distDir, 'sitemap.xml'), html: site.sitemapXml() },
    { file: join(distDir, 'robots.txt'), html: site.robotsTxt() },
    { file: tokensFile, html: site.siteTokensCss() },
    {
      file: join(distDir, 'site-pages.json'),
      html: `${JSON.stringify(siteManifest(pages), null, 2)}\n`,
    },
  );
  for (const { file, html } of outputs) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  return { pages: pages.length };
}

export type SiteRoute =
  { kind: 'page'; outPath: string } | { kind: 'redirect'; outPath: string; location: string };

const SLUG = /^[a-z0-9-]+$/u;
const SLUG_HTML = /^([a-z0-9-]+)\.html$/u;
const NOT_SITE = /^\/(@|src\/|node_modules\/|assets\/|site\/|e2e\/)/u;

function page(slug: string, locale: Parameters<typeof pageOutPath>[1]): SiteRoute {
  return { kind: 'page', outPath: pageOutPath(slug, locale) };
}

function redirect(slug: string, locale: Parameters<typeof pageOutPath>[1]): SiteRoute {
  return { kind: 'redirect', outPath: pageOutPath(slug, locale), location: pagePath(slug, locale) };
}

// '/', '/es/', '/pt-BR/', '/rules', '/es/rules' -> page; '/es', '/index', '/index.html', '/rules/',
// '/rules.html' -> redirect to the clean URL; else null. Case-insensitive on the locale prefix only.
export function routeSitePath(pathname: string): SiteRoute | null {
  if (NOT_SITE.test(pathname)) return null;
  const segments = pathname.split('/').slice(1);
  const locale = localeOfPath(pathname);
  const prefixed = pathLocaleOf(locale) !== '';
  const rest = prefixed ? segments.slice(1) : segments;
  if (rest.length === 0) return redirect('', locale); // '/es' -> '/es/'
  const [name = '', trailing] = rest;
  if (rest.length > 2 || (trailing !== undefined && trailing !== '')) return null;
  if (name === '') return trailing === undefined ? page('', locale) : null;
  const slugHtml = SLUG_HTML.exec(name)?.[1];
  const slug = slugHtml ?? (SLUG.test(name) ? name : undefined);
  if (slug === undefined || (slugHtml !== undefined && trailing !== undefined)) return null;
  if (slug === 'index') return redirect('', locale);
  if (slugHtml !== undefined || trailing !== undefined) return redirect(slug, locale);
  return page(slug, locale);
}

type DevServer = Pick<ViteDevServer, 'ssrLoadModule' | 'transformIndexHtml' | 'ssrFixStacktrace'>;

// GET|HEAD: route -> ssrLoadModule -> renderSite lookup -> 307 | injectPage + transformIndexHtml -> 200; else next().
export function siteDevMiddleware(server: DevServer, root: string): Connect.NextHandleFunction {
  async function handle(
    req: Connect.IncomingMessage,
    res: Parameters<Connect.NextHandleFunction>[1],
    next: Connect.NextFunction,
    route: SiteRoute,
    search: string,
  ): Promise<void> {
    // Loaded per request: Vite invalidates SSR modules on change, so every render is fresh.
    const site = (await server.ssrLoadModule(SITE_ENTRY)) as SiteModule;
    const rendered = site.renderSite().find((p) => p.outPath === route.outPath);
    if (rendered === undefined) return next();
    if (route.kind === 'redirect') {
      res.statusCode = 307;
      res.setHeader('Location', `${route.location}${search}`);
      res.end();
      return;
    }
    const template = readFileSync(join(root, rendered.template), 'utf8');
    const html = await server.transformIndexHtml(
      req.url ?? '/',
      injectPage(template, rendered, rendered.template),
      req.originalUrl,
    );
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.method === 'HEAD') res.end();
    else res.end(html);
  }

  return function sitePagesDev(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routeSitePath(url.pathname);
    if (route === null) return next();
    handle(req, res, next, route, url.search).catch((error: unknown) => {
      if (error instanceof Error) server.ssrFixStacktrace(error);
      next(error);
    });
  };
}

// GET|HEAD /site/tokens.css -> ssrLoadModule(server.tsx).siteTokensCss() -> 200 text/css, no-cache; else next().
export function siteTokensMiddleware(
  server: Pick<ViteDevServer, 'ssrLoadModule' | 'ssrFixStacktrace'>,
): Connect.NextHandleFunction {
  async function handle(
    req: Connect.IncomingMessage,
    res: Parameters<Connect.NextHandleFunction>[1],
  ): Promise<void> {
    // Loaded per request, so a token edit shows on the next reload.
    const site = (await server.ssrLoadModule(SITE_ENTRY)) as SiteModule;
    const css = site.siteTokensCss();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') res.end();
    else res.end(css);
  }

  return function siteTokensDev(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== `/${SITE_TOKENS_PATH}`) return next();
    handle(req, res).catch((error: unknown) => {
      if (error instanceof Error) server.ssrFixStacktrace(error);
      next(error);
    });
  };
}

// Post hook: '/<template>' after the SPA fallback -> 404, so a raw template is never served.
export function siteTemplateNotFound(templates: readonly string[]): Connect.NextHandleFunction {
  return function siteTemplate404(req, res, next) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (!templates.some((template) => pathname === `/${template}`)) return next();
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('not found');
  };
}

interface BuildState {
  root: string;
  outDir: string;
  configFile: string | false;
  mode: string;
  ssr: boolean;
}

export function sitePages(opts?: { createServer?: typeof createServer }): Plugin[] {
  const create = opts?.createServer ?? createServer;
  let state: BuildState | undefined;

  const build: Plugin = {
    name: 'site-pages:build',
    apply: 'build',
    configResolved(config) {
      state = {
        root: config.root,
        outDir: resolve(config.root, config.build.outDir),
        configFile: config.configFile ?? false,
        mode: config.mode,
        ssr: Boolean(config.build.ssr),
      };
    },
    async closeBundle(error?: Error) {
      if (error !== undefined || state === undefined || state.ssr) return;
      // Same config file, so the SSR render gets the client's plugins, define and CSS Module names.
      // ws: false, or a middleware-mode server binds port 24678 and clashes with a running vite dev.
      const server = await create({
        configFile: state.configFile,
        root: state.root,
        mode: state.mode,
        logLevel: 'warn',
        appType: 'custom',
        server: { middlewareMode: true, ws: false, watch: null, hmr: false },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
      try {
        const site = (await server.ssrLoadModule(SITE_ENTRY)) as SiteModule;
        const { pages } = writeSiteFiles(state.outDir, site);
        console.log(`site-pages: ${pages} pages`);
      } finally {
        await server.close();
      }
    },
  };

  const serve: Plugin = {
    name: 'site-pages:serve',
    apply: 'serve',
    configureServer(server) {
      // Installed directly: runs before Vite's public/ static handler, HTML fallback and clean-urls.
      server.middlewares.use(siteTokensMiddleware(server));
      server.middlewares.use(siteDevMiddleware(server, server.config.root));
      const templates = SITE_TEMPLATE_KEYS.map((key) => HTML_ENTRIES[key]).filter(
        (file): file is string => file !== undefined,
      );
      return () => {
        server.middlewares.use(siteTemplateNotFound(templates));
      };
    },
  };

  return [build, serve];
}
