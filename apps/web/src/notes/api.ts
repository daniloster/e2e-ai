// The notes app's API client (the fixture API on localhost:4010 in dev; VITE_PN_API_URL overrides).
export interface Note {
  id: string;
  title: string;
  description: string;
  done: boolean;
}

export interface Session {
  token: string;
  email: string;
}

export const API_URL: string =
  (import.meta.env.VITE_PN_API_URL as string | undefined) ?? 'http://localhost:4010';

async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(API_URL + path, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const notesApi = {
  login: (email: string, password: string) =>
    call<{ token: string; user: { email: string } }>('POST', '/auth/login', undefined, { email, password }),
  me: (token: string) => call<{ email: string }>('GET', '/me', token),
  list: (token: string) => call<Note[]>('GET', '/notes', token),
  add: (token: string, title: string) => call<Note>('POST', '/notes', token, { title }),
  setDone: (token: string, id: string, done: boolean) => call<Note>('PATCH', `/notes/${id}`, token, { done }),
  remove: (token: string, id: string) => call<void>('DELETE', `/notes/${id}`, token),
};
