# Pocket Notes — mobile demo app (`apps/mobile`)

A small React Native 0.88 app (New Architecture, Hermes, Expo SDK 58 modules) used as the mobile
target of the e2e suite in `e2e/`. Debug bundle id `com.pocketnotes.dev`, URL scheme `pocketnotes`.
Standalone npm project linking `@pn/core`, `@pn/design-tokens` and `@pn/i18n` from `apps-modules/`.

## Screens

Home → **My notes** (sign in, list, add, tick done, delete, sign out) against the fixture API
(`apps-modules/fixture-api`, `http://localhost:4010`), plus Play and Settings from the starter app.
The notes screens use the same `testID`s as the web app (`signin-email`, `notes-add`,
`note-row-<id>`, …) so one plan replays on both.

## E2E hooks (debug builds only)

| Hook | For | Where |
|---|---|---|
| In-app bridge (WebSocket `ws://localhost:4011`): page source from the React tree, taps/typing via props | the `rn-bridge` / `rn-mcp` integration (gray-box) | `src/testing/e2eBridge.ts`, `E2EProbe` in `App.tsx` |
| Deep links `pocketnotes://signin`, `pocketnotes://notes?session=<token>`, `pocketnotes://e2e-reset` | black-box integrations (Appium, Maestro, adb) | `AppProvider.tsx`; Android: `android/app/src/debug/AndroidManifest.xml` |

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
