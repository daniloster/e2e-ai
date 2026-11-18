// Pocket Notes, the deliberately small web app the e2e tool is spiked against: sign in, list notes,
// add, tick done, delete, sign out. Hash routes (#/signin, #/notes); `?session=<token>` signs in
// directly (the e2e "access" shortcut).
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { createTranslator } from '@pn/i18n';

import { notesApi, type Note, type Session } from './api';
import styles from './notes.module.css';

const translator = createTranslator('en-GB');
const t = translator.t.bind(translator);
const SESSION_KEY = 'pn.session';

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // private mode: the session lasts as long as the page
  }
}

const routeOf = (hash: string): 'signin' | 'notes' => (hash.startsWith('#/notes') ? 'notes' : 'signin');

export function NotesApp(): JSX.Element {
  const [session, setSession] = useState<Session | null>(readSession);
  const [route, setRoute] = useState(routeOf(location.hash));

  useEffect(() => {
    const sync = () => {
      setRoute(routeOf(location.hash));
      const params = new URLSearchParams(location.search);
      const token = params.get('session');
      if (token) {
        history.replaceState(null, '', location.pathname + location.hash);
        notesApi.me(token).then(
          (me) => {
            const s = { token, email: me.email };
            writeSession(s);
            setSession(s);
            location.hash = '#/notes';
          },
          () => undefined,
        );
      }
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const signedIn = (s: Session | null) => {
    writeSession(s);
    setSession(s);
    location.hash = s ? '#/notes' : '#/signin';
  };

  return (
    <main className={styles.app}>
      {session && route === 'notes' ? (
        <NotesScreen session={session} onSignOut={() => signedIn(null)} />
      ) : (
        <SignInScreen onSignedIn={signedIn} />
      )}
    </main>
  );
}

function SignInScreen({ onSignedIn }: { onSignedIn(s: Session): void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(false);
    notesApi.login(email, password).then(
      (r) => onSignedIn({ token: r.token, email: r.user.email }),
      () => setError(true),
    );
  };
  return (
    <form className={styles.card} onSubmit={submit} aria-labelledby="signin-title">
      <h1 id="signin-title">{t('notes.signInTitle')}</h1>
      <label htmlFor="signin-email">{t('notes.email')}</label>
      <input id="signin-email" data-testid="signin-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="signin-password">{t('notes.password')}</label>
      <input id="signin-password" data-testid="signin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && (
        <p role="alert" data-testid="signin-error" className={styles.error}>
          {t('notes.signInFailed')}
        </p>
      )}
      <button type="submit" data-testid="signin-submit">
        {t('notes.signIn')}
      </button>
    </form>
  );
}

function NotesScreen({ session, onSignOut }: { session: Session; onSignOut(): void }): JSX.Element {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    notesApi.list(session.token).then(setNotes, () => setFailed(true));
  }, [session.token]);
  useEffect(reload, [reload]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    notesApi.add(session.token, title).then(() => {
      setDraft('');
      reload();
    });
  };

  return (
    <section className={styles.card} aria-labelledby="notes-title">
      <header className={styles.header}>
        <h1 id="notes-title" data-testid="notes-title">
          {t('notes.title')}
        </h1>
        <button type="button" className={styles.link} data-testid="notes-signout" onClick={onSignOut}>
          {t('notes.signOut')}
        </button>
      </header>
      <p className={styles.muted} data-testid="notes-user">
        {t('notes.signedInAs', { email: session.email })}
      </p>
      <form className={styles.row} onSubmit={add}>
        <label htmlFor="notes-new" className={styles.visuallyHidden}>
          {t('notes.newLabel')}
        </label>
        <input id="notes-new" data-testid="notes-new" placeholder={t('notes.newPlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" data-testid="notes-add">
          {t('notes.add')}
        </button>
      </form>
      {failed && <p role="alert">{t('notes.loadFailed')}</p>}
      {notes && notes.length === 0 && <p data-testid="notes-empty">{t('notes.empty')}</p>}
      {notes && notes.length > 0 && (
        <>
          <p className={styles.muted} data-testid="notes-count">
            {t('notes.count', { count: notes.length })}
          </p>
          <ul className={styles.list}>
            {notes.map((n) => (
              <li key={n.id} data-testid={`note-row-${n.id}`} className={n.done ? styles.done : undefined}>
                <label>
                  <input
                    type="checkbox"
                    data-testid={`note-done-${n.id}`}
                    checked={n.done}
                    onChange={() => notesApi.setDone(session.token, n.id, !n.done).then(reload)}
                  />
                  <span className={styles.texts}>
                    <span>{n.title}</span>
                    {n.description && (
                      <small className={styles.muted} data-testid={`note-description-${n.id}`}>
                        {n.description}
                      </small>
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  className={styles.link}
                  data-testid={`note-delete-${n.id}`}
                  aria-label={t('notes.deleteA11y', { title: n.title })}
                  onClick={() => notesApi.remove(session.token, n.id).then(reload)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
