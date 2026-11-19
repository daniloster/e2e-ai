# Pocket Notes — mobile demo app (`apps/mobile`)

A small React Native 0.88 app (New Architecture, Hermes, Expo SDK 58 modules) used as the mobile
target of the e2e suite in `e2e/`. Debug bundle id `com.pocketnotes.dev`, URL scheme `pocketnotes`.
Standalone npm project linking `@pn/core`, `@pn/design-tokens` and `@pn/i18n` from `apps-modules/`.

## Screens

Home → **My notes** (sign in, list, add, tick done, delete, sign out) against the fixture API
(`apps-modules/fixture-api`, `http://localhost:4010`), plus Play and Settings from the starter app.
The notes screens use the same `testID`s as the web app (`signin-email`, `notes-add`,
`note-row-<id>`, …) so one plan replays on both.

## E2E hooks (debug and e2e builds only)

On when `E2E_HOOKS` (`src/testing/e2eHooks.ts`: `__DEV__ || __E2E__`) is true; off in release builds.

| Hook | For | Where |
|---|---|---|
| In-app bridge (WebSocket `E2E_BRIDGE_URL`, default `ws://localhost:4011`): page source from the React tree, taps/typing via props | the `rn-bridge` / `rn-mcp` integration (gray-box) | `src/testing/e2eBridge.ts`, `E2EProbe` in `App.tsx` |
| Deep links `pocketnotes://signin`, `pocketnotes://notes?session=<token>`, `pocketnotes://e2e-reset` | black-box integrations (Appium, Maestro, adb) | `AppProvider.tsx`; Android: `android/app/src/{debug,e2e}/AndroidManifest.xml` |

## Run

```sh
cd apps/mobile
npm install
npm start                       # Metro on port 8093
cd ios && bundle exec pod install && cd ..
npx react-native run-ios        # or: npm run android   (then adb reverse tcp:8093, tcp:4010, tcp:4011)
npm test && npx tsc --noEmit
```

Then from the repo root: `PN_SIM=<simulator udid> npx e2e-ai run --target ios` (bridge) or
`--target ios-appium` (Appium), `--target android` / `android-appium` / `android-maestro`.

## Cloud / e2e build

Device clouds (Sauce Labs, BrowserStack) cannot load JavaScript from Metro, and debug builds need it.
The **e2e build** is a release build with the JS bundled (Hermes) that keeps the e2e hooks above.
Android: build type `e2e` (app id `com.pocketnotes.e2e`, "Pocket Notes E2E", launcher activity
`com.pocketnotes.MainActivity`, debug-signed, R8 off, cleartext HTTP allowed for the test API).

```sh
E2E_API_URL=http://bs-local.com:4010 E2E_BRIDGE_URL=ws://bs-local.com:4011 npm run android:build:e2e
# → android/app/build/outputs/apk/e2e/app-e2e.apk
```

Build-time variables, inlined as literals by `babel/inline-e2e-env.js` (Metro's transform cache is
keyed on them, so switching builds never reuses stale transforms):

| Variable | Constant | Default | Meaning |
|---|---|---|---|
| `E2E_BUILD=1` | `__E2E__` | off | Keep the e2e hooks in a bundled (non-Metro) build |
| `E2E_API_URL` | `__E2E_API_URL__` | `http://localhost:4010` | The fixture API the app calls (every build) |
| `E2E_BRIDGE_URL` | `__E2E_BRIDGE_URL__` | `ws://localhost:4011` | The e2e runner the in-app bridge connects to |

The URLs must be reachable *from the device*: on BrowserStack Local the API is typically
`http://bs-local.com:4010`; on Sauce Connect use a hostname the tunnel resolves to your machine;
on the Android emulator `http://10.0.2.2:4010`. Never `localhost` on a cloud device (on iOS it is the
device itself). Without `E2E_BUILD=1` a release build behaves exactly as before (hooks off).
