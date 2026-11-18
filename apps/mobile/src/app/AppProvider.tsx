// The root provider: the app reducer, translations, the side effects of each action (persistence,
// analytics consent, screen events), the player ID and incoming share links (cold start and warm).
// One context for the whole app. Services are injectable so screens are tested without natives.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type React from 'react';
import { Alert, Linking, Platform, Settings } from 'react-native';

import * as analytics from '../services/analytics';
import * as identity from '../services/identity';
import { me } from '../services/notesApi';
import * as storage from '../services/storage';
import { registerE2EHandlers } from '../testing/e2eBridge';
import { openDevRoute } from './devRoutes';
import { createT, deviceLocale } from './i18n';
import type { TFunction } from './i18n';
import { parseShareLink } from './links';
import { initialState, reducer } from './state';
import type { AppAction, AppState } from './state';

export interface AppServices {
  storage: Pick<
    typeof storage,
    | 'getLocale'
    | 'getAnalyticsConsent'
    | 'setAnalyticsConsent'
    | 'getBest'
    | 'setBest'
  >;
  analytics: Pick<
    typeof analytics,
    'track' | 'setCollectionEnabled' | 'recordError'
  >;
  identity: Pick<
    typeof identity,
    'deviceUniqueId' | 'isTestInstall' | 'playerIdOf' | 'appVersion'
  >;
  linking: Pick<typeof Linking, 'getInitialURL' | 'addEventListener'>;
  /** The clock, for stored timestamps (injectable for tests). */
  now: () => number;
}

export const DEFAULT_SERVICES: AppServices = {
  storage,
  analytics,
  identity,
  linking: Linking,
  now: () => Date.now(),
};

interface AppContextValue {
  state: AppState;
  dispatch: (a: AppAction) => void;
  t: TFunction;
  services: AppServices;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside AppProvider');
  return value;
}

export function AppProvider(props: {
  children: React.ReactNode;
  services?: AppServices;
  initial?: Partial<AppState>;
}): React.JSX.Element {
  const services = props.services ?? DEFAULT_SERVICES;
  const [state, rawDispatch] = useReducer(reducer, {
    ...initialState,
    ...props.initial,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // The reducer runs here too, so each side effect sees the state the action produced; an action
  // that changes nothing has no effect.
  const dispatch = useCallback(
    (a: AppAction) => {
      const prev = stateRef.current;
      const next = reducer(prev, a);
      rawDispatch(a);
      stateRef.current = next;
      if (next === prev) return;
      switch (a.type) {
        case 'SET_ANALYTICS_CONSENT':
          // Enable first so the choice event itself is sent when the user allows it.
          void services.analytics.setCollectionEnabled(a.granted).then(() =>
            services.analytics.track({
              name: 'consent_choice',
              params: { granted: a.granted },
            }),
          );
          void services.storage.setAnalyticsConsent(a.granted, services.now());
          break;
        case 'NAVIGATE':
          void services.analytics.track({
            name: 'screen',
            params: { screen: a.screen },
          });
          break;
        case 'PLAY':
          void services.analytics.track({
            name: 'game_start',
            params: { source: a.source, blocks: a.blocks },
          });
          break;
        case 'RECORD_SCORE':
          void services.storage.setBest(a.score, services.now());
          break;
        default:
          break;
      }
    },
    [services],
  );

  // Hydration: stored values first (the splash waits for them), then the player ID.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      services.storage.getLocale(),
      services.storage.getAnalyticsConsent(),
      services.storage.getBest(),
    ])
      .then(async ([locale, consent, best]) => {
        if (cancelled) return;
        await services.analytics.setCollectionEnabled(
          consent?.analytics === true,
        );
        rawDispatch({
          type: 'HYDRATE',
          locale: locale ?? deviceLocale(),
          analyticsConsent:
            consent === null
              ? 'unknown'
              : consent.analytics
                ? 'granted'
                : 'denied',
          best,
        });
        void services.analytics.track({
          name: 'screen',
          params: { screen: 'home' },
        });
      })
      .catch((error: unknown) => {
        services.analytics.recordError(error, 'app.hydrate', 'app');
        rawDispatch({
          type: 'HYDRATE',
          locale: deviceLocale(),
          analyticsConsent: 'unknown',
          best: null,
        });
      });
    services.identity
      .deviceUniqueId()
      .then(async id => {
        const [playerId, testInstall] = await Promise.all([
          services.identity.playerIdOf(id),
          services.identity.isTestInstall(),
        ]);
        if (!cancelled)
          rawDispatch({ type: 'SET_PLAYER_ID', playerId, testInstall });
      })
      .catch((error: unknown) =>
        services.analytics.recordError(error, 'identity.player_id', 'identity'),
      );
    return () => {
      cancelled = true;
    };
  }, [services]);

  const t = useMemo(() => createT(state.locale), [state.locale]);
  const tRef = useRef(t);
  tRef.current = t;

  // Debug builds: the e2e routes of docs/app-guide.md. The in-app bridge calls them directly; black-box
  // drivers (Appium, Maestro, adb) open them as deep links: pocketnotes://signin,
  // pocketnotes://notes?session=<token>, pocketnotes://e2e-reset. Never active in release builds.
  const e2eOpenRoute = useCallback(
    async (route: string, params: Record<string, string>) => {
      if (route === 'e2e-reset') {
        dispatch({ type: 'E2E_RESET' });
        return;
      }
      if (params.session) {
        const user = await me(params.session);
        dispatch({
          type: 'SIGNED_IN',
          session: { token: params.session, email: user.email },
        });
        return;
      }
      if (route === 'signin' || route === 'notes' || route === 'home' || route === 'settings') {
        dispatch({ type: 'NAVIGATE', screen: route });
        return;
      }
      throw new Error(`unknown route ${route}`);
    },
    [dispatch],
  );

  // A share link: decode it and start that board; tell the player when it cannot be opened.
  const openLink = useCallback(
    (url: string) => {
      if (__DEV__) {
        const m = /^pocketnotes:\/\/(e2e-reset|signin|notes|home|settings)\/?(?:\?(.*))?$/.exec(url);
        if (m) {
          const params = Object.fromEntries(new URLSearchParams(m[2] ?? ''));
          e2eOpenRoute(m[1] as string, params).catch((error: unknown) =>
            services.analytics.recordError(error, 'e2e.deep_link', 'link'),
          );
          return;
        }
      }
      if (__DEV__ && openDevRoute(url, stateRef.current, dispatch)) return;
      const result = parseShareLink(url);
      if (result === null) return;
      void services.analytics.track({
        name: 'link_opened',
        params: { result: result.ok ? 'ok' : 'invalid' },
      });
      if (!result.ok) {
        const tr = tRef.current;
        Alert.alert(
          tr('common.linkErrorTitle'),
          tr(
            result.error === 'unsupportedLink'
              ? 'common.linkUnsupported'
              : 'common.linkInvalid',
          ),
        );
        return;
      }
      dispatch({ type: 'PLAY', blocks: result.blocks, source: 'link' });
    },
    [services, dispatch, e2eOpenRoute],
  );

  useEffect(() => {
    if (!state.hydrated) return;
    let active = true;
    services.linking
      .getInitialURL()
      .then(url => {
        if (active && url) openLink(url);
      })
      .catch((error: unknown) =>
        services.analytics.recordError(error, 'link.initial', 'link'),
      );
    // Debug builds on iOS: a URL written to the app's defaults (`PNDevURL`, README "Dev routes") is
    // opened like a cold-start link, for simulators where `simctl openurl` stops at a system prompt.
    if (__DEV__ && Platform.OS === 'ios') {
      try {
        const devUrl: unknown = Settings.get('PNDevURL');
        if (typeof devUrl === 'string' && devUrl.length > 0) {
          Settings.set({ PNDevURL: '' });
          openLink(devUrl);
        }
      } catch {
        // No SettingsManager (tests); nothing to open.
      }
    }
    const subscription = services.linking.addEventListener(
      'url',
      (event: { url: string }) => openLink(event.url),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, [state.hydrated, services, openLink]);

  // Debug builds: the in-app e2e bridge (gray-box driver) uses the same routes.
  useEffect(() => {
    if (!__DEV__) return;
    return registerE2EHandlers({
      reset: () => dispatch({ type: 'E2E_RESET' }),
      openRoute: e2eOpenRoute,
    });
  }, [dispatch, e2eOpenRoute]);

  const value = useMemo(
    () => ({ state, dispatch, t, services }),
    [state, dispatch, t, services],
  );
  return (
    <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
  );
}
