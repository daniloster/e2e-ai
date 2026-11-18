const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');

const defaults = getDefaultConfig(__dirname);

// The shared packages' own imports (@pn/i18n → @pn/core, …) resolve as if from this app, so there
// is one copy of each, from this app's node_modules, whether or not the repo root is installed.
const APP_ORIGIN = path.join(__dirname, 'index.js');
const FROM_APP = /^@pn\//;

/**
 * Metro configuration: Expo modules (expo/metro-config), the shared packages under ../../apps-modules
 * (`@pn/*` via file: dependencies), and one node_modules (this app's). The repo-root node_modules
 * (apps/web's React) is deliberately not resolved from.
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '../../apps-modules')],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    resolveRequest(context, moduleName, platform) {
      if (FROM_APP.test(moduleName))
        return context.resolveRequest(
          { ...context, originModulePath: APP_ORIGIN },
          moduleName,
          platform,
        );
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaults, config);
