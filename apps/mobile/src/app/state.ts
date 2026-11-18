// The app's one reducer (no navigation library): which screen is showing, the player's identity and
// choices, and what the play screen plays. Pure; side effects (storage, analytics) live in
// AppProvider.
import type { Locale } from './i18n';

export type Screen = 'home' | 'play' | 'settings' | 'signin' | 'notes';

/** A signed-in notes session (the fixture API's bearer token). */
export interface NotesSession {
  token: string;
  email: string;
}
export type AnalyticsConsent = 'unknown' | 'granted' | 'denied';

/** Where a played board came from: a new game from Home, or a share link. */
export type PlaySource = 'new' | 'link';

/** What the play screen plays; `nonce` changes with every request, which restarts the screen. */
export interface PlayRequest {
  blocks: number;
  source: PlaySource;
  nonce: number;
}

export interface AppState {
  /** false until stored values are read; the splash stays up until then. */
  hydrated: boolean;
  screen: Screen;
  locale: Locale;
  /** 8 upper-case hex characters, null until computed. */
  playerId: string | null;
  /** An Android debug or sideloaded build: its player ID differs from the Play Store app's. */
  testInstall: boolean;
  analyticsConsent: AnalyticsConsent;
  /** The best score on this device; null before the first cleared board. */
  best: number | null;
  play: PlayRequest;
  /** The notes session; null when signed out. Not persisted. */
  session: NotesSession | null;
}

export type AppAction =
  | {
      type: 'HYDRATE';
      locale: Locale;
      analyticsConsent: AnalyticsConsent;
      best: number | null;
    }
  | { type: 'SET_PLAYER_ID'; playerId: string; testInstall: boolean }
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'SET_ANALYTICS_CONSENT'; granted: boolean }
  | { type: 'PLAY'; blocks: number; source: PlaySource }
  | { type: 'RECORD_SCORE'; score: number }
  | { type: 'SIGNED_IN'; session: NotesSession }
  | { type: 'SIGN_OUT' }
  /** Debug builds only (the e2e bridge): signed out, consent answered, on Home. */
  | { type: 'E2E_RESET' };

/** The board a new game from Home starts with. */
export const DEFAULT_BLOCKS = 20;

export const initialState: AppState = {
  hydrated: false,
  screen: 'home',
  locale: 'en-GB',
  playerId: null,
  testInstall: false,
  analyticsConsent: 'unknown',
  best: null,
  play: { blocks: DEFAULT_BLOCKS, source: 'new', nonce: 0 },
  session: null,
};

export function reducer(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'HYDRATE':
      return {
        ...s,
        hydrated: true,
        locale: a.locale,
        analyticsConsent: a.analyticsConsent,
        best: a.best,
      };
    case 'SET_PLAYER_ID':
      return { ...s, playerId: a.playerId, testInstall: a.testInstall };
    case 'NAVIGATE':
      return a.screen === s.screen ? s : { ...s, screen: a.screen };
    case 'SET_ANALYTICS_CONSENT':
      return { ...s, analyticsConsent: a.granted ? 'granted' : 'denied' };
    case 'PLAY':
      return {
        ...s,
        screen: 'play',
        play: { blocks: a.blocks, source: a.source, nonce: s.play.nonce + 1 },
      };
    case 'SIGNED_IN':
      return { ...s, session: a.session, screen: 'notes' };
    case 'SIGN_OUT':
      return { ...s, session: null, screen: 'signin' };
    case 'E2E_RESET':
      return {
        ...s,
        session: null,
        screen: 'home',
      };
    case 'RECORD_SCORE':
      // Only a better score changes anything (and is persisted by AppProvider).
      return s.best !== null && a.score <= s.best ? s : { ...s, best: a.score };
  }
}
