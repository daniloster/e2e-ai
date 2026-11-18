// Local HTTPS static server for the built site, resolving paths like Cloudflare's
// auto-trailing-slash: an existing file serves itself, /<name> serves <name>.html, a directory
// serves its index.html, /<name>/ redirects 307 to /<name> when <name>.html exists, and anything
// else answers 404 (with 404.html when present). There is no SPA fallback to index.html. The 200
// splat rewrites of <root>/_redirects apply first, as on Cloudflare (`/a/* /b 200`).
// Serves apps/web/dist over HTTPS on 0.0.0.0:8443 with a self-signed cert, so a device
// on the local network (e.g. a phone's browser) can load the page directly.
// Usage: node https/serve.mjs [root] [port]   (defaults: ../dist 8443)
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function isFile(path) {
  return (await statOrNull(path))?.isFile() === true;
}

/**
 * Resolves a request path against the served directory.
 * @param {string} root  absolute directory served
 * @param {string} pathname  URL pathname, still percent-encoded, no query
 * @returns {Promise<{status: 200, file: string} | {status: 307, location: string} | {status: 403} | {status: 404, file: string | null}>}
 */
export async function resolveFile(root, pathname) {
  const rootAbs = normalize(root);
  const rewritten = await rewriteOf(rootAbs, pathname);
  if (rewritten !== null) return resolveFile(root, rewritten);
  const page404 = join(rootAbs, '404.html');
  const notFound = async () => ({ status: 404, file: (await isFile(page404)) ? page404 : null });

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  // Path-traversal guard: strip leading ../ and refuse anything that escapes root.
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/u, '');
  const file = join(rootAbs, rel).replace(/[/\\]+$/u, '');
  if (file !== rootAbs && !file.startsWith(rootAbs + sep)) return { status: 403 };

  const trailingSlash = file !== rootAbs && /[/\\]$/u.test(rel);
  const found = await statOrNull(file);
  if (!trailingSlash && found?.isFile()) return { status: 200, file };
  if (!trailingSlash && file !== rootAbs && !extname(rel) && (await isFile(`${file}.html`))) {
    return { status: 200, file: `${file}.html` };
  }
  if (found?.isDirectory()) {
    const index = join(file, 'index.html');
    return (await isFile(index)) ? { status: 200, file: index } : notFound();
  }
  if (trailingSlash && (await isFile(`${file}.html`))) {
    return { status: 307, location: pathname.replace(/\/+$/u, '') };
  }
  return notFound();
}

/**
 * The target of the first `<prefix>/* <target> 200` rule in <root>/_redirects matching pathname,
 * or null (the file is optional; other rule shapes are ignored).
 * @param {string} rootAbs
 * @param {string} pathname
 * @returns {Promise<string | null>}
 */
export async function rewriteOf(rootAbs, pathname) {
  const rules = await readOrNull(join(rootAbs, '_redirects'));
  if (rules === null) return null;
  for (const line of rules.toString('utf8').split('\n')) {
    const [from, to, status] = line.trim().split(/\s+/u);
    if (status !== '200' || !from?.endsWith('/*') || !to) continue;
    const prefix = from.slice(0, -1);
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) return to;
  }
  return null;
}

async function readOrNull(file) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

// Request handler: 200 body | 307 Location + query | 403 | 404 (404.html when present).
async function handle(root, req, res) {
  const url = new URL(req.url ?? '/', 'https://localhost');
  const result = await resolveFile(root, url.pathname);
  const body = result.file ? await readOrNull(result.file) : null;
  if (result.status === 307) {
    res.writeHead(307, { location: `${result.location}${url.search}` }).end();
  } else if (result.status === 403) {
    res.writeHead(403).end('forbidden');
  } else if (result.status === 200 && body) {
    res.writeHead(200, {
      'content-type': types[extname(result.file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } else if (result.status === 404 && body) {
    res.writeHead(404, { 'content-type': types['.html'] }).end(body);
  } else {
    res.writeHead(404).end('not found');
  }
  console.log(new Date().toISOString(), req.method, req.url, req.socket.remoteAddress);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = import.meta.dirname;
  const [rootArg, portArg = '8443'] = process.argv.slice(2);
  const root = rootArg ? normalize(join(process.cwd(), rootArg)) : join(dir, '..', 'dist');
  const port = Number(portArg);
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  // Self-contained: create the cert on first run so `node https/serve.mjs` works alone.
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    spawnSync(process.execPath, [join(dir, 'gen-cert.mjs')], { stdio: 'inherit' });
  }
  const tls = { key: await readFile(keyPath), cert: await readFile(certPath) };
  createServer(tls, (req, res) => handle(root, req, res)).listen(port, '0.0.0.0', () =>
    console.log(`https on :${port} (root: ${normalize(root)})`),
  );
}
