#!/usr/bin/env bash
# CI: the first XCUITest session builds WebDriverAgent (several minutes on a fresh runner). Open and
# close one session up front, so the e2e run's session finds WebDriverAgent built and running.
#   PN_SIM=<udid> scripts/ci/ios-wda-warmup.sh
set -euo pipefail
caps=$(printf '{"capabilities":{"alwaysMatch":{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"%s","appium:wdaLaunchTimeout":900000,"appium:wdaConnectionTimeout":900000}}}' "$PN_SIM")
resp=$(curl -sS --max-time 1200 -H 'content-type: application/json' -d "$caps" http://127.0.0.1:4723/session)
session=$(node -e 'const r = JSON.parse(process.argv[1]); if (!r.value?.sessionId) { console.error(JSON.stringify(r).slice(0, 2000)); process.exit(1); } console.log(r.value.sessionId)' "$resp")
curl -sS -o /dev/null -X DELETE "http://127.0.0.1:4723/session/$session"
echo "WebDriverAgent ready (warm-up session $session closed)"
