// The notes API facade: the fixture API (apps-modules/fixture-api) on the dev machine. The iOS simulator
// shares the Mac's network; Android reaches it through `adb reverse tcp:4010 tcp:4010`. The URL is
// E2E_API_URL at build time (default http://localhost:4010; README "Cloud / e2e build").
export interface Note {
  id: string;
  title: string;
  description: string;
  done: boolean;
}

export const NOTES_API_URL: string = __E2E_API_URL__;

async function call<T>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(NOTES_API_URL + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`notes api ${method} ${path}: ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function login(
  email: string,
  password: string,
): Promise<{ token: string; user: { email: string } }> {
  return call('POST', '/auth/login', undefined, { email, password });
}
export function me(token: string): Promise<{ email: string }> {
  return call('GET', '/me', token);
}
export function listNotes(token: string): Promise<Note[]> {
  return call('GET', '/notes', token);
}
export function addNote(token: string, title: string): Promise<Note> {
  return call('POST', '/notes', token, { title });
}
export function setDone(token: string, id: string, done: boolean): Promise<Note> {
  return call('PATCH', `/notes/${encodeURIComponent(id)}`, token, { done });
}
export function removeNote(token: string, id: string): Promise<void> {
  return call('DELETE', `/notes/${encodeURIComponent(id)}`, token);
}
