/**
 * @format
 */
import { AppRegistry } from 'react-native';
import { App } from './src/App';
import { name as appName } from './app.json';

// Silence a known third-party warning here with LogBox.ignoreLogs([...exact message]) only, with a
// comment naming the library and when to remove it (never our own warnings).
AppRegistry.registerComponent(appName, () => App);
