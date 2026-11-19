#!/usr/bin/env bash
# CI: the first XCUITest session builds WebDriverAgent (several minutes on a fresh runner). Open and
# close one session up front, so the e2e run's session finds WebDriverAgent built and running.
# A cold runner's simulator can take longer than Appium's default 120 s to settle, so the boot
# timeout is raised and the warm-up is retried.
#   PN_SIM=<udid> scripts/ci/ios-wda-warmup.sh
set -euo pipefail
caps=$(printf '{"capabilities":{"alwaysMatch":{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"%s","appium:simulatorStartupTimeout":600000,"appium:wdaLaunchTimeout":900000,"appium:wdaConnectionTimeout":900000}}}' "$PN_SIM")
for attempt in 1 2 3; do
  xcrun simctl bootstatus "$PN_SIM" -b >/dev/null
  resp=$(curl -sS --max-time 1200 -H 'content-type: application/json' -d "$caps" http://127.0.0.1:4723/session || true)
  if session=$(node -e 'const r = JSON.parse(process.argv[1] || "{}"); if (!r.value?.sessionId) { console.error(JSON.stringify(r).slice(0, 2000)); process.exit(1); } console.log(r.value.sessionId)' "$resp"); then
    curl -sS -o /dev/null -X DELETE "http://127.0.0.1:4723/session/$session"
    echo "WebDriverAgent ready (warm-up session $session closed, attempt $attempt)"
    exit 0
  fi
  echo "warm-up attempt $attempt failed" >&2
done
exit 1
