// State-switched screens (no navigation library), plus the consent question while unknown. Nothing renders until the stored values are read; the native
// splash stays up until then and fades out once.
import type React from 'react';
import { useEffect } from 'react';
import BootSplash from 'react-native-bootsplash';

import { ConsentSheet } from '../components/ConsentSheet';
import { HomeScreen } from '../screens/HomeScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { PlayScreen } from '../screens/PlayScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { useApp } from './AppProvider';

export function ScreenSwitch(): React.JSX.Element | null {
  const { state } = useApp();

  useEffect(() => {
    if (state.hydrated) BootSplash.hide({ fade: true }).catch(() => undefined);
  }, [state.hydrated]);

  if (!state.hydrated) return null;
  return (
    <>
      {state.screen === 'home' && <HomeScreen />}
      {/* A new play request (Home, a link) starts a fresh game. */}
      {state.screen === 'play' && <PlayScreen key={state.play.nonce} />}
      {state.screen === 'settings' && <SettingsScreen />}
      {state.screen === 'signin' && <SignInScreen />}
      {state.screen === 'notes' &&
        (state.session ? <NotesScreen /> : <SignInScreen />)}
      <ConsentSheet visible={state.analyticsConsent === 'unknown'} />
    </>
  );
}
