// A typed client for the fixture API's test-seeding routes and login. The e2e context (pockets)
// uses it to create data before a scenario drives the UI. Works in Node 22 (global fetch).
import type { Note, PublicUser } from './store.ts';

export interface FixtureClient {
  reset(): Promise<void>;
  createUser(input: { email: string; password: string; name?: string }): Promise<PublicUser>;
  createNote(input: { ownerEmail: string; title: string; description?: string; done?: boolean }): Promise<Note>;
  login(email: string, password: string): Promise<{ token: string; user: PublicUser }>;
  listNotes(token: string): Promise<Note[]>;
}

export function createFixtureClient(baseUrl = 'http://127.0.0.1:4010'): FixtureClient {
  async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(baseUrl + path, init);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
  return {
    reset: () => call('POST', '/__test/reset'),
    createUser: (input) => call('POST', '/__test/users', input),
    createNote: (input) => call('POST', '/__test/notes', input),
    login: (email, password) => call('POST', '/auth/login', { email, password }),
    listNotes: (token) => call('GET', '/notes', undefined, token),
  };
}
