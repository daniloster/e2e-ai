// The app: one provider (state, services, side effects) and the screen switch.
import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from './app/AppProvider';
import { ScreenSwitch } from './app/ScreenSwitch';
import { setE2ERoot, startE2EBridge } from './testing/e2eBridge';
import { UI_COLORS } from './theme';

export function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        <E2EProbe>
          <AppProvider>
            <ScreenSwitch />
          </AppProvider>
        </E2EProbe>
      </View>
    </SafeAreaProvider>
  );
}

// Debug builds: gives the e2e bridge a handle on the React tree (a class instance knows its fiber)
// and opens the bridge connection. A pass-through in release builds.
class E2EProbe extends React.Component<{ children: React.ReactNode }> {
  componentDidMount(): void {
    if (__DEV__) {
      setE2ERoot(this);
      startE2EBridge();
    }
  }
  render(): React.ReactNode {
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: UI_COLORS.bg },
});
