import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureClient } from './client.ts';
import { startServer } from './server.ts';

let server: Server;
const PORT = 4910;
const client = createFixtureClient(`http://127.0.0.1:${PORT}`);

beforeAll(async () => {
  server = await startServer(PORT);
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('fixture api', () => {
  it('seeds a user and notes, then the app API lists them for that user only', async () => {
    await client.reset();
    await client.createUser({ email: 'Ana@Example.com', password: 'pw' });
    await client.createUser({ email: 'bo@example.com', password: 'pw' });
    await client.createNote({ ownerEmail: 'ana@example.com', title: 'Milk' });
    await client.createNote({ ownerEmail: 'bo@example.com', title: 'Eggs' });
    const { token, user } = await client.login('ana@example.com', 'pw');
    expect(user.email).toBe('ana@example.com');
    const notes = await client.listNotes(token);
    expect(notes.map((n) => n.title)).toEqual(['Milk']);
  });

  it('rejects a wrong password and unauthenticated note reads', async () => {
    await client.reset();
    await client.createUser({ email: 'ana@example.com', password: 'pw' });
    await expect(client.login('ana@example.com', 'nope')).rejects.toThrow(/401/);
    await expect(client.listNotes('bogus')).rejects.toThrow(/401/);
  });

  it('creates, toggles and deletes notes through the app routes', async () => {
    await client.reset();
    await client.createUser({ email: 'ana@example.com', password: 'pw' });
    const { token } = await client.login('ana@example.com', 'pw');
    const base = `http://127.0.0.1:${PORT}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const created = await (
      await fetch(`${base}/notes`, { method: 'POST', headers, body: JSON.stringify({ title: 'Bread' }) })
    ).json();
    const patched = await (
      await fetch(`${base}/notes/${created.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ done: true }),
      })
    ).json();
    expect(patched.done).toBe(true);
    const del = await fetch(`${base}/notes/${created.id}`, { method: 'DELETE', headers });
    expect(del.status).toBe(204);
    expect(await client.listNotes(token)).toEqual([]);
  });
});
