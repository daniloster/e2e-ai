// The fixture HTTP API the Pocket Notes apps talk to, plus test-only `/__test/*` seeding routes the
// e2e "pockets" call to create data. Dev/test only: binds to localhost, never deployed (CLAUDE.md).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createStore, type Store } from './store.ts';

export const DEFAULT_PORT = 4010;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Routes one request against `store`. Exported for tests (no socket needed). */
export async function handle(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') return send(res, 204);

  try {
    // --- test-only seeding (the e2e data API) ---
    if (path === '/__test/reset' && method === 'POST') {
      store.reset();
      return send(res, 204);
    }
    if (path === '/__test/users' && method === 'POST') {
      const b = await readJson(req);
      const email = str(b.email);
      const password = str(b.password);
      if (!email || !password) return send(res, 400, { error: 'email and password required' });
      const name = str(b.name);
      return send(res, 201, store.createUser(name ? { email, password, name } : { email, password }));
    }
    if (path === '/__test/notes' && method === 'POST') {
      const b = await readJson(req);
      const owner = store.userByEmail(str(b.ownerEmail) ?? '');
      const title = str(b.title);
      if (!owner || !title) return send(res, 400, { error: 'known ownerEmail and title required' });
      return send(res, 201, store.createNote(owner.id, { title, description: str(b.description) ?? '', done: b.done === true }));
    }

    // --- app API ---
    if (path === '/health') return send(res, 200, { ok: true });
    if (path === '/auth/login' && method === 'POST') {
      const b = await readJson(req);
      const session = store.login(str(b.email) ?? '', str(b.password) ?? '');
      return session ? send(res, 200, session) : send(res, 401, { error: 'invalid credentials' });
    }

    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const user = token ? store.userForToken(token) : null;
    if (path.startsWith('/notes') || path === '/me') {
      if (!user) return send(res, 401, { error: 'sign in first' });
    }
    if (path === '/me' && method === 'GET' && user) {
      return send(res, 200, { id: user.id, email: user.email, name: user.name });
    }
    if (path === '/notes' && method === 'GET' && user) return send(res, 200, store.listNotes(user.id));
    if (path === '/notes' && method === 'POST' && user) {
      const b = await readJson(req);
      const title = str(b.title)?.trim();
      if (!title) return send(res, 400, { error: 'title required' });
      return send(res, 201, store.createNote(user.id, { title, description: str(b.description)?.trim() ?? '' }));
    }
    const m = /^\/notes\/([^/]+)$/.exec(path);
    if (m && user) {
      const id = decodeURIComponent(m[1] ?? '');
      if (method === 'PATCH') {
        const b = await readJson(req);
        const patch: { title?: string; done?: boolean } = {};
        if (typeof b.title === 'string') patch.title = b.title;
        if (typeof b.done === 'boolean') patch.done = b.done;
        const note = store.updateNote(user.id, id, patch);
        return note ? send(res, 200, note) : send(res, 404, { error: 'not found' });
      }
      if (method === 'DELETE') {
        return store.deleteNote(user.id, id) ? send(res, 204) : send(res, 404, { error: 'not found' });
      }
    }
    return send(res, 404, { error: `no route ${method} ${path}` });
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Starts the API on localhost:`port`. Resolves once listening. */
export function startServer(port = DEFAULT_PORT, store: Store = createStore()): Promise<Server> {
  const server = createServer((req, res) => void handle(store, req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
