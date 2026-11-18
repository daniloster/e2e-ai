// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, createServer, Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SITE_LOCALES, pageOutPath, pagePath } from '../src/site/config.ts';
import { SITE_PAGES } from '../src/site/pages.ts';
import type { RenderedPage } from '../src/site/server.tsx';
import { HTML_ENTRIES, SITE_TEMPLATE_KEYS } from './htmlEntries';
import {
  SITE_JS_BUDGET_BYTES,
  injectPage,
  routeSitePath,
  scriptBudgetProblems,
  siteDevMiddleware,
  sitePages,
  SITE_TOKENS_PATH,
  siteTemplateNotFound,
  siteManifest,
  siteTokensMiddleware,
  urlPathOf,
  writeSiteFiles,
  type SiteModule,
  type SitePageEntry,
} from './sitePages';

const FIXTURE =
  '<html lang="en-GB"><head><!--site-head--></head><body><!--site-body--><script type="module" src="/assets/home-x.js"></script></body></html>';

const HOME_PAGES: readonly RenderedPage[] = [
  {
    outPath: 'index.html',
    template: 'index.html',
    head: '<title>en</title>',
    body: '<main>en body</main>',
    lang: 'en-GB',
    sitePage: 'home',
  },
  {
    outPath: 'es/index.html',
    template: 'index.html',
    head: '<title>es</title>',
    body: '<main>es body</main>',
    lang: 'es',
    sitePage: 'home',
  },
  {
    outPath: 'pt-br/index.html',
    template: 'index.html',
    head: '<title>pt</title>',
    body: '<main>pt body</main>',
    lang: 'pt-BR',
    sitePage: 'home',
  },
];

function fakeSite(pages: readonly RenderedPage[] = HOME_PAGES): SiteModule {
  return {
    renderSite: () => pages,
    sitemapXml: () => '<urlset/>',
    robotsTxt: () => 'User-agent: *\n',
    siteTokensCss: () => ':root{--color-ground:#2a1650;}',
  };
}

const dirs: string[] = [];

function tempDist(files: Record<string, string | Buffer> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'site-pages-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      out[path] = readFileSync(path, 'base64');
    }
  }
  return out;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('injectPage', () => {
  it('sets lang and fills the head and body markers', () => {
    const html = injectPage(
      FIXTURE,
      { lang: 'pt-BR', head: '<title>x</title>', body: '<main>$&</main>' },
      'index.html',
    );
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('<head><title>x</title></head>');
    expect(html).toContain('<main>$&</main>');
    expect(html).not.toContain('<!--site-');
  });

  it('keeps the other attributes of the html start tag', () => {
    const html = injectPage(
      FIXTURE.replace('<html lang="en-GB">', '<html class="a" lang="en" dir="ltr">'),
      { lang: 'es', head: '', body: '' },
      'index.html',
    );
    expect(html).toContain('<html class="a" lang="es" dir="ltr">');
  });

  it('writes data-site-page after lang when sitePage is given', () => {
    const html = injectPage(
      '<html lang="en-GB"><head><!--site-head--></head><body><!--site-body--></body></html>',
      { lang: 'es', head: '', body: '', sitePage: 'your_data' },
      'index.html',
    );
    expect(html).toContain('<html lang="es" data-site-page="your_data">');
  });

  it.each(['<html lang="en-GB" data-site-page="faq">', '<html data-site-page="faq" lang="en-GB">'])(
    'replaces the data-site-page of %s',
    (start) => {
      const html = injectPage(
        FIXTURE.replace('<html lang="en-GB">', start),
        { lang: 'pt-BR', head: '', body: '', sitePage: 'home' },
        'index.html',
      );
      expect(html.match(/data-site-page=/g)).toHaveLength(1);
      expect(html).toContain('lang="pt-BR" data-site-page="home">');
    },
  );

  it('keeps the plain output when sitePage is absent', () => {
    const page = { lang: 'es', head: '<title>x</title>', body: '<main>y</main>' } as const;
    expect(injectPage(FIXTURE, page, 'index.html')).toBe(
      FIXTURE.replace('<html lang="en-GB">', '<html lang="es">')
        .replace('<!--site-head-->', '<title>x</title>')
        .replace('<!--site-body-->', '<main>y</main>'),
    );
    const withPage = FIXTURE.replace(
      '<html lang="en-GB">',
      '<html lang="en-GB" data-site-page="faq">',
    );
    expect(injectPage(withPage, page, 'index.html')).toContain(
      '<html lang="es" data-site-page="faq">',
    );
  });

  it.each([
    ['a missing body marker', FIXTURE.replace('<!--site-body-->', '')],
    [
      'a doubled head marker',
      FIXTURE.replace('<!--site-head-->', '<!--site-head--><!--site-head-->'),
    ],
    ['an html tag without lang', FIXTURE.replace('<html lang="en-GB">', '<html>')],
  ])('throws naming the template for %s', (_case, template) => {
    expect(() => injectPage(template, { lang: 'en-GB', head: '', body: '' }, 'faq.html')).toThrow(
      /faq\.html/,
    );
  });
});

describe('scriptBudgetProblems', () => {
  it('accepts a small script', () => {
    const dist = tempDist({ 'assets/home-x.js': 'console.log(1);'.repeat(64) });
    expect(scriptBudgetProblems(dist, FIXTURE, 30 * 1024)).toEqual([]);
  });

  it('reports a page over the limit with each file size', () => {
    const dist = tempDist({
      'assets/home-x.js': randomBytes(40 * 1024),
      'assets/dep.js': 'export {};',
    });
    const html = `${FIXTURE}<link rel="modulepreload" crossorigin href="/assets/dep.js?v=1">`;
    const problems = scriptBudgetProblems(dist, html, 30 * 1024);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/exceeds 30720 B/);
    expect(problems[0]).toContain('/assets/home-x.js');
    expect(problems[0]).toContain('/assets/dep.js');
  });

  it('reports a referenced file that does not exist', () => {
    expect(scriptBudgetProblems(tempDist(), FIXTURE)).toEqual(['missing script /assets/home-x.js']);
  });

  it('ignores classic and cross-origin scripts', () => {
    const html =
      '<script src="/assets/a.js"></script><script type="module" src="https://cdn.example/x.js"></script><link rel="stylesheet" href="/assets/a.css">';
    expect(scriptBudgetProblems(tempDist(), html)).toEqual([]);
    expect(SITE_JS_BUDGET_BYTES).toBe(30 * 1024);
  });
});

describe('urlPathOf', () => {
  it.each([
    ['index.html', '/'],
    ['pt-br/index.html', '/pt-br/'],
    ['es/index.html', '/es/'],
    ['how-to-play.html', '/how-to-play'],
    ['es/faq.html', '/es/faq'],
    ['pt-br/get.html', '/pt-br/get'],
  ])('maps %s to %s', (outPath, path) => {
    expect(urlPathOf(outPath)).toBe(path);
  });

  it.each(['es/', 'faq'])('throws an Error naming %s when it is not .html', (outPath) => {
    expect(() => urlPathOf(outPath)).toThrow(new RegExp(`"${outPath}"`));
  });

  it('agrees with pagePath for every page and locale of SITE_PAGES', () => {
    for (const page of SITE_PAGES) {
      for (const locale of SITE_LOCALES) {
        expect(urlPathOf(pageOutPath(page.slug, locale))).toBe(pagePath(page.slug, locale));
      }
    }
  });
});

describe('siteManifest', () => {
  it('lists one entry per page in order, with the canonical url and the analytics id', () => {
    const entries: SitePageEntry[] = siteManifest([
      ...HOME_PAGES,
      { ...HOME_PAGES[1]!, outPath: 'es/faq.html', template: 'faq.html', sitePage: 'faq' },
    ]);
    expect(entries.map((e) => e.path)).toEqual(['/', '/es/', '/pt-br/', '/es/faq']);
    expect(entries[3]).toEqual({
      path: '/es/faq',
      file: 'es/faq.html',
      url: 'https://pocketnotes.app/es/faq',
      lang: 'es',
      page: 'faq',
    });
  });
});

describe('writeSiteFiles', () => {
  it('writes site-pages.json with the three homes and still returns the page count', () => {
    const dist = tempDist({ 'index.html': FIXTURE, 'assets/home-x.js': 'export {};' });
    expect(writeSiteFiles(dist, fakeSite())).toEqual({ pages: 3 });
    const text = readFileSync(join(dist, 'site-pages.json'), 'utf8');
    expect(text.endsWith('}\n]\n')).toBe(true);
    expect(text).toContain('\n  {\n    "path": "/",');
    expect(JSON.parse(text)).toEqual([
      {
        path: '/',
        file: 'index.html',
        url: 'https://pocketnotes.app/',
        lang: 'en-GB',
        page: 'home',
      },
      {
        path: '/es/',
        file: 'es/index.html',
        url: 'https://pocketnotes.app/es/',
        lang: 'es',
        page: 'home',
      },
      {
        path: '/pt-br/',
        file: 'pt-br/index.html',
        url: 'https://pocketnotes.app/pt-br/',
        lang: 'pt-BR',
        page: 'home',
      },
    ]);
  });

  it('writes every locale page, the sitemap and robots.txt', () => {
    const dist = tempDist({ 'index.html': FIXTURE, 'assets/home-x.js': 'export {};' });
    expect(writeSiteFiles(dist, fakeSite())).toEqual({ pages: 3 });
    const en = readFileSync(join(dist, 'index.html'), 'utf8');
    const es = readFileSync(join(dist, 'es/index.html'), 'utf8');
    const pt = readFileSync(join(dist, 'pt-br/index.html'), 'utf8');
    expect(en).toContain('<html lang="en-GB" data-site-page="home">');
    expect(en).toContain('<main>en body</main>');
    expect(es).toMatch(/<html lang="es" data-site-page="home">/);
    expect(es).toContain('<main>es body</main>');
    expect(es).not.toContain('en body');
    expect(pt).toContain('<html lang="pt-BR" data-site-page="home">');
    expect(readFileSync(join(dist, 'sitemap.xml'), 'utf8')).toBe('<urlset/>');
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toBe('User-agent: *\n');
  });

  it('writes site/tokens.css, creating dist/site/, and still counts only pages', () => {
    const dist = tempDist({ 'index.html': FIXTURE, 'assets/home-x.js': 'export {};' });
    expect(SITE_TOKENS_PATH).toBe('site/tokens.css');
    expect(writeSiteFiles(dist, fakeSite())).toEqual({ pages: 3 });
    expect(readFileSync(join(dist, 'site/tokens.css'), 'utf8')).toBe(
      ':root{--color-ground:#2a1650;}',
    );
  });

  it('throws before writing when site/tokens.css already exists in dist', () => {
    const dist = tempDist({
      'index.html': FIXTURE,
      'assets/home-x.js': 'export {};',
      'site/tokens.css': ':root{}',
    });
    const before = snapshot(dist);
    expect(() => writeSiteFiles(dist, fakeSite())).toThrow(/apps\/web\/public\/site\/tokens\.css/);
    expect(() => writeSiteFiles(dist, fakeSite())).toThrow(/generated/);
    expect(snapshot(dist)).toEqual(before);
  });

  it.each([
    ['a parent-relative out path', [{ ...HOME_PAGES[0]!, outPath: '../x.html' }]],
    ['an absolute out path', [{ ...HOME_PAGES[0]!, outPath: '/tmp/x.html' }]],
    ['a non-html out path', [{ ...HOME_PAGES[0]!, outPath: 'x.txt' }]],
    [
      'a missing template',
      [...HOME_PAGES, { ...HOME_PAGES[0]!, outPath: 'faq.html', template: 'faq.html' }],
    ],
  ])('throws on %s and writes nothing', (_case, pages) => {
    const dist = tempDist({ 'index.html': FIXTURE, 'assets/home-x.js': 'export {};' });
    const before = snapshot(dist);
    expect(() => writeSiteFiles(dist, fakeSite(pages))).toThrow(/site-pages/);
    expect(snapshot(dist)).toEqual(before);
  });

  it('throws when a page is over the JS budget, before writing', () => {
    const dist = tempDist({ 'index.html': FIXTURE, 'assets/home-x.js': randomBytes(40 * 1024) });
    const before = snapshot(dist);
    expect(() => writeSiteFiles(dist, fakeSite())).toThrow(/index\.html: JS \d+ B gzip exceeds/);
    expect(snapshot(dist)).toEqual(before);
  });
});

type CloseBundle = (this: unknown, error?: Error) => Promise<void>;
type ConfigResolved = (this: unknown, config: ResolvedConfig) => void;

function hook<T>(plugin: Plugin, name: 'closeBundle' | 'configResolved'): T {
  const h = plugin[name] as unknown;
  return (typeof h === 'function' ? h : (h as { handler: T }).handler) as T;
}

function fakeServerFactory(site: SiteModule) {
  const close = vi.fn(async () => {});
  const ssrLoadModule = vi.fn(async () => site);
  const factory = vi.fn(async () => ({ close, ssrLoadModule }));
  return { factory, close, ssrLoadModule };
}

function buildPlugin(factory: unknown): Plugin {
  const plugin = sitePages({ createServer: factory as typeof createServer })[0];
  if (plugin === undefined) throw new Error('no build plugin');
  return plugin;
}

function resolvedConfig(root: string, ssr: boolean | string = false): ResolvedConfig {
  return {
    root,
    mode: 'production',
    configFile: join(root, 'vite.config.ts'),
    build: { outDir: 'dist', ssr },
  } as unknown as ResolvedConfig;
}

describe('sitePages build plugin', () => {
  it('is the first plugin, build only', () => {
    expect(sitePages()[0]).toMatchObject({ name: 'site-pages:build', apply: 'build' });
  });

  it('renders through an SSR server and writes dist', async () => {
    const root = tempDist({ 'dist/index.html': FIXTURE, 'dist/assets/home-x.js': 'export {};' });
    const { factory, close, ssrLoadModule } = fakeServerFactory(fakeSite());
    const plugin = buildPlugin(factory);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    hook<ConfigResolved>(plugin, 'configResolved').call({}, resolvedConfig(root));
    await hook<CloseBundle>(plugin, 'closeBundle').call({});

    expect(readFileSync(join(root, 'dist/es/index.html'), 'utf8')).toContain(
      '<html lang="es" data-site-page="home">',
    );
    expect(ssrLoadModule).toHaveBeenCalledWith('/src/site/server.tsx');
    expect(close).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('site-pages: 3 pages');
    log.mockRestore();
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        configFile: join(root, 'vite.config.ts'),
        root,
        mode: 'production',
        appType: 'custom',
        server: expect.objectContaining({ middlewareMode: true, ws: false }),
      }),
    );
  });

  it('closes the server when writing fails', async () => {
    const root = tempDist();
    const { factory, close } = fakeServerFactory(fakeSite());
    const plugin = buildPlugin(factory);
    hook<ConfigResolved>(plugin, 'configResolved').call({}, resolvedConfig(root));
    await expect(hook<CloseBundle>(plugin, 'closeBundle').call({})).rejects.toThrow(/template/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing after a failed build, for an SSR build, or before configResolved', async () => {
    const root = tempDist();
    const { factory } = fakeServerFactory(fakeSite());
    const plugin = buildPlugin(factory);
    await hook<CloseBundle>(plugin, 'closeBundle').call({});
    hook<ConfigResolved>(plugin, 'configResolved').call({}, resolvedConfig(root));
    await hook<CloseBundle>(plugin, 'closeBundle').call({}, new Error('x'));
    hook<ConfigResolved>(plugin, 'configResolved').call({}, resolvedConfig(root, 'src/x.ts'));
    await hook<CloseBundle>(plugin, 'closeBundle').call({});
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('routeSitePath', () => {
  it.each([
    ['/', 'index.html'],
    ['/es/', 'es/index.html'],
    ['/pt-br/', 'pt-br/index.html'],
    ['/pt-BR/', 'pt-br/index.html'],
    ['/faq', 'faq.html'],
    ['/es/faq', 'es/faq.html'],
    ['/pt-br/your-data', 'pt-br/your-data.html'],
  ])('%s renders %s', (path, outPath) => {
    expect(routeSitePath(path)).toEqual({ kind: 'page', outPath });
  });

  it.each([
    ['/es', 'es/index.html', '/es/'],
    ['/pt-BR', 'pt-br/index.html', '/pt-br/'],
    ['/index', 'index.html', '/'],
    ['/index/', 'index.html', '/'],
    ['/index.html', 'index.html', '/'],
    ['/pt-br/index.html', 'pt-br/index.html', '/pt-br/'],
    ['/faq/', 'faq.html', '/faq'],
    ['/faq.html', 'faq.html', '/faq'],
    ['/es/faq/', 'es/faq.html', '/es/faq'],
    ['/es/faq.html', 'es/faq.html', '/es/faq'],
  ])('%s redirects (out path %s) to %s', (path, outPath, location) => {
    expect(routeSitePath(path)).toEqual({ kind: 'redirect', outPath, location });
  });

  it.each([
    '/src/site/client/home.ts',
    '/@vite/client',
    '/@id/x',
    '/node_modules/.vite/x.js',
    '/assets/x.js',
    '/site/favicon.svg',
    '/e2e/harness.html',
    '/a/b/c',
    '/a/b',
    '/es/a/b',
    '/Rules',
    '/faq.html/',
    '/es//',
    '/favicon.ico',
  ])('leaves %s alone', (path) => {
    expect(routeSitePath(path)).toBeNull();
  });
});

describe('site templates', () => {
  it('builds exactly the templates the page registry fills', () => {
    const templates = SITE_TEMPLATE_KEYS.map((key) => HTML_ENTRIES[key]);
    expect(templates).toEqual([...new Set(SITE_PAGES.map((p) => p.template))]);
  });
});

interface Result {
  status: number | undefined;
  headers: Record<string, string>;
  body: string | undefined;
  ended: boolean;
  nextCalls: number;
  nextError: unknown;
}

function run(handler: Connect.NextHandleFunction, method: string, url: string): Promise<Result> {
  return new Promise((done) => {
    const result: Result = {
      status: undefined,
      headers: {},
      body: undefined,
      ended: false,
      nextCalls: 0,
      nextError: undefined,
    };
    const req = { method, url, originalUrl: url } as unknown as IncomingMessage;
    const res = {
      set statusCode(value: number) {
        result.status = value;
      },
      setHeader(name: string, value: string) {
        result.headers[name] = value;
      },
      end(body?: string) {
        result.body = body;
        result.ended = true;
        done(result);
      },
    } as unknown as ServerResponse;
    handler(req, res, (error?: unknown) => {
      result.nextCalls += 1;
      result.nextError = error;
      done(result);
    });
  });
}

function fakeDevServer(site: SiteModule | Error) {
  return {
    ssrLoadModule: vi.fn(async () => {
      if (site instanceof Error) throw site;
      return site;
    }),
    transformIndexHtml: vi.fn(async (_url: string, html: string) => `${html}<!--transformed-->`),
    ssrFixStacktrace: vi.fn(),
  };
}

function devHandler(site: SiteModule | Error = fakeSite()) {
  const root = tempDist({ 'index.html': FIXTURE });
  const server = fakeDevServer(site);
  const handler = siteDevMiddleware(server as unknown as ViteDevServer, root);
  return { handler, server };
}

describe('siteDevMiddleware', () => {
  it.each(['/es/', '/es/?x=1'])(
    'GET %s renders the es home through transformIndexHtml',
    async (url) => {
      const { handler, server } = devHandler();
      const result = await run(handler, 'GET', url);
      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(result.body).toContain('<html lang="es" data-site-page="home">');
      expect(result.body).toContain('<title>es</title>');
      expect(result.body).toContain('<main>es body</main>');
      expect(result.body).toContain('<!--transformed-->');
      expect(result.nextCalls).toBe(0);
      expect(server.ssrLoadModule).toHaveBeenCalledWith('/src/site/server.tsx');
      expect(server.transformIndexHtml).toHaveBeenCalledWith(url, expect.any(String), url);
    },
  );

  it('answers HEAD with no body', async () => {
    const { handler } = devHandler();
    const result = await run(handler, 'HEAD', '/es/');
    expect(result.status).toBe(200);
    expect(result.body).toBeUndefined();
  });

  it.each([
    ['/es', '/es/'],
    ['/index.html?lang=es', '/?lang=es'],
  ])('GET %s redirects 307 to %s', async (url, location) => {
    const { handler } = devHandler();
    const result = await run(handler, 'GET', url);
    expect(result.status).toBe(307);
    expect(result.headers.Location).toBe(location);
    expect(result.ended).toBe(true);
    expect(result.nextCalls).toBe(0);
  });

  it.each([
    ['GET', '/faq'],
    ['GET', '/faq/'],
    ['GET', '/src/main.tsx'],
    ['POST', '/'],
  ])('%s %s calls next() untouched', async (method, url) => {
    const { handler } = devHandler();
    const result = await run(handler, method, url);
    expect(result.nextCalls).toBe(1);
    expect(result.nextError).toBeUndefined();
    expect(result.status).toBeUndefined();
  });

  it('fixes the stack trace and passes a render error to next()', async () => {
    const error = new Error('boom');
    const { handler, server } = devHandler(error);
    const result = await run(handler, 'GET', '/');
    expect(server.ssrFixStacktrace).toHaveBeenCalledWith(error);
    expect(result.nextError).toBe(error);
  });

  it('passes a non-Error rejection to next() without fixing a stack', async () => {
    const server = fakeDevServer(fakeSite());
    server.ssrLoadModule.mockRejectedValueOnce('nope');
    const handler = siteDevMiddleware(server as unknown as ViteDevServer, tempDist());
    const result = await run(handler, 'GET', '/');
    expect(server.ssrFixStacktrace).not.toHaveBeenCalled();
    expect(result.nextError).toBe('nope');
  });
});

describe('siteTokensMiddleware', () => {
  it('GET /site/tokens.css?v=1 answers the SSR stylesheet, no-cache', async () => {
    const server = fakeDevServer(fakeSite());
    const result = await run(siteTokensMiddleware(server), 'GET', '/site/tokens.css?v=1');
    expect(result.status).toBe(200);
    expect(result.headers['Content-Type']).toBe('text/css; charset=utf-8');
    expect(result.headers['Cache-Control']).toBe('no-cache');
    expect(result.body).toBe(':root{--color-ground:#2a1650;}');
    expect(server.ssrLoadModule).toHaveBeenCalledWith('/src/site/server.tsx');
  });

  it('reloads the SSR module on every request', async () => {
    const server = fakeDevServer(fakeSite());
    const handler = siteTokensMiddleware(server);
    await run(handler, 'GET', '/site/tokens.css');
    await run(handler, 'GET', '/site/tokens.css');
    expect(server.ssrLoadModule).toHaveBeenCalledTimes(2);
  });

  it('answers HEAD with no body', async () => {
    const result = await run(
      siteTokensMiddleware(fakeDevServer(fakeSite())),
      'HEAD',
      '/site/tokens.css',
    );
    expect(result.status).toBe(200);
    expect(result.body).toBeUndefined();
  });

  it.each([
    ['GET', '/site/mark.svg'],
    ['GET', '/site/tokens.css/x'],
    ['POST', '/site/tokens.css'],
  ])('%s %s calls next() untouched', async (method, url) => {
    const server = fakeDevServer(fakeSite());
    const result = await run(siteTokensMiddleware(server), method, url);
    expect(result.nextCalls).toBe(1);
    expect(result.nextError).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(server.ssrLoadModule).not.toHaveBeenCalled();
  });

  it('fixes the stack trace and passes a load error to next()', async () => {
    const error = new Error('boom');
    const server = fakeDevServer(error);
    const result = await run(siteTokensMiddleware(server), 'GET', '/site/tokens.css');
    expect(server.ssrFixStacktrace).toHaveBeenCalledWith(error);
    expect(result.nextError).toBe(error);
  });

  it('passes a non-Error rejection to next() without fixing a stack', async () => {
    const server = fakeDevServer(fakeSite());
    server.ssrLoadModule.mockRejectedValueOnce('nope');
    const result = await run(siteTokensMiddleware(server), 'GET', '/site/tokens.css');
    expect(server.ssrFixStacktrace).not.toHaveBeenCalled();
    expect(result.nextError).toBe('nope');
  });
});

describe('siteTemplateNotFound', () => {
  const handler = siteTemplateNotFound(['index.html']);

  it('answers 404 for a raw site template', async () => {
    const result = await run(handler, 'GET', '/index.html');
    expect(result.status).toBe(404);
    expect(result.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(result.body).toBe('not found');
  });

  it.each(['/other.html', '/e2e/harness.html'])('calls next() for %s', async (url) => {
    const result = await run(handler, 'GET', url);
    expect(result.nextCalls).toBe(1);
    expect(result.status).toBeUndefined();
  });
});

describe('sitePages serve plugin', () => {
  it('installs the tokens and dev middlewares first and the template 404 as a post hook', async () => {
    const plugin = sitePages()[1];
    expect(plugin).toMatchObject({ name: 'site-pages:serve', apply: 'serve' });
    const use = vi.fn();
    const server = {
      ...fakeDevServer(fakeSite()),
      config: { root: tempDist({ 'index.html': FIXTURE }) },
      middlewares: { use },
    };
    const configure = plugin?.configureServer as unknown as (s: unknown) => () => void;
    const post = configure(server);
    expect(use).toHaveBeenCalledTimes(2);
    expect((await run(use.mock.calls[0]?.[0], 'GET', '/site/tokens.css')).body).toBe(
      ':root{--color-ground:#2a1650;}',
    );
    expect((await run(use.mock.calls[1]?.[0], 'GET', '/pt-br/')).body).toContain('lang="pt-BR"');
    post();
    expect(use).toHaveBeenCalledTimes(3);
    expect((await run(use.mock.calls[2]?.[0], 'GET', '/index.html')).status).toBe(404);
  });
});
