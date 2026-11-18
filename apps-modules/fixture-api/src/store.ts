// The fixture API's in-memory state: users, sessions and notes. Pure data operations, no I/O, so the
// HTTP layer (server.ts) and the tests share one implementation. Dev/test only: never deployed.

export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
}

export interface Note {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  done: boolean;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface Store {
  reset(): void;
  createUser(input: { email: string; password: string; name?: string }): PublicUser;
  login(email: string, password: string): { token: string; user: PublicUser } | null;
  userForToken(token: string): User | null;
  listNotes(ownerId: string): Note[];
  createNote(ownerId: string, input: { title: string; description?: string; done?: boolean }): Note;
  updateNote(ownerId: string, id: string, patch: { title?: string; done?: boolean }): Note | null;
  deleteNote(ownerId: string, id: string): boolean;
  userByEmail(email: string): User | null;
}

export function toPublic(u: User): PublicUser {
  return { id: u.id, email: u.email, name: u.name };
}

/** A fresh store. `clock` orders notes deterministically in tests. */
export function createStore(clock: () => number = () => Date.now()): Store {
  let users: User[] = [];
  let notes: Note[] = [];
  let sessions = new Map<string, string>(); // token -> user id
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  return {
    reset() {
      users = [];
      notes = [];
      sessions = new Map();
      seq = 0;
    },
    createUser({ email, password, name }) {
      const normalised = email.trim().toLowerCase();
      if (users.some((u) => u.email === normalised)) throw new Error(`user ${normalised} exists`);
      const user: User = {
        id: nextId('u'),
        email: normalised,
        password,
        name: name ?? normalised.split('@')[0] ?? normalised,
      };
      users.push(user);
      return toPublic(user);
    },
    login(email, password) {
      const user = users.find((u) => u.email === email.trim().toLowerCase());
      if (!user || user.password !== password) return null;
      const token = `t-${user.id}-${++seq}`;
      sessions.set(token, user.id);
      return { token, user: toPublic(user) };
    },
    userForToken(token) {
      const id = sessions.get(token);
      return id === undefined ? null : (users.find((u) => u.id === id) ?? null);
    },
    listNotes(ownerId) {
      return notes.filter((n) => n.ownerId === ownerId).sort((a, b) => a.createdAt - b.createdAt);
    },
    createNote(ownerId, { title, description, done }) {
      const note: Note = {
        id: nextId('n'),
        ownerId,
        title,
        description: description ?? '',
        done: done ?? false,
        createdAt: clock() + seq,
      };
      notes.push(note);
      return note;
    },
    updateNote(ownerId, id, patch) {
      const note = notes.find((n) => n.id === id && n.ownerId === ownerId);
      if (!note) return null;
      if (patch.title !== undefined) note.title = patch.title;
      if (patch.done !== undefined) note.done = patch.done;
      return note;
    },
    deleteNote(ownerId, id) {
      const before = notes.length;
      notes = notes.filter((n) => !(n.id === id && n.ownerId === ownerId));
      return notes.length < before;
    },
    userByEmail(email) {
      return users.find((u) => u.email === email.trim().toLowerCase()) ?? null;
    },
  };
}
