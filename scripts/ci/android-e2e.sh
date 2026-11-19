#!/usr/bin/env bash
# CI, inside the Android emulator (reactivecircus/android-emulator-runner): installs the e2e build and
# runs every scenario through Appium with the reviewed plans only (no model).
# Needs: Appium on :4723, the fixture API on :4010 (the e2e build calls the host as 10.0.2.2).
set -euo pipefail
apk=apps/mobile/android/app/build/outputs/apk/e2e/app-e2e.apk
adb wait-for-device
adb install -r "$apk"
export PN_ANDROID_APP_ID=com.pocketnotes.e2e
node packages/e2e-ai-cli/src/cli.ts run --target android-appium --replay --no-ai-report
