#!/usr/bin/env bash
# CI: the first XCUITest session builds WebDriverAgent (several minutes on a fresh runner), and the
# Debug app's first launch downloads its JavaScript from Metro (well over 20 s on a cold runner).
# Do both up front in one throwaway session, so the e2e run starts on a ready WebDriverAgent and an
# app that loads at once. A cold simulator can take longer than Appium's default 120 s to settle, so
# the boot timeout is raised and the warm-up is retried.
#   PN_SIM=<udid> [PN_IOS_APP_ID=com.pocketnotes.dev] scripts/ci/ios-wda-warmup.sh
set -euo pipefail
app=${PN_IOS_APP_ID:-com.pocketnotes.dev}
api=http://127.0.0.1:4723
caps=$(printf '{"capabilities":{"alwaysMatch":{"platformName":"iOS","appium:automationName":"XCUITest","appium:udid":"%s","appium:simulatorStartupTimeout":600000,"appium:wdaLaunchTimeout":900000,"appium:wdaConnectionTimeout":900000}}}' "$PN_SIM")
session=
for attempt in 1 2 3; do
  xcrun simctl bootstatus "$PN_SIM" -b >/dev/null
  resp=$(curl -sS --max-time 1200 -H 'content-type: application/json' -d "$caps" "$api/session" || true)
  if session=$(node -e 'const r = JSON.parse(process.argv[1] || "{}"); if (!r.value?.sessionId) { console.error(JSON.stringify(r).slice(0, 2000)); process.exit(1); } console.log(r.value.sessionId)' "$resp"); then
    echo "WebDriverAgent ready (attempt $attempt)"
    break
  fi
  session=
  echo "warm-up attempt $attempt failed" >&2
done
[ -n "$session" ] || exit 1

# Launch the app and wait until its own UI is on screen (no "Loading from Metro…" banner, a control
# visible): Metro has then built and served the bundle the e2e run's launches reuse.
curl -sS -o /dev/null --max-time 300 -H 'content-type: application/json' \
  -d "{\"script\":\"mobile: launchApp\",\"args\":[{\"bundleId\":\"$app\"}]}" "$api/session/$session/execute/sync" || true
ready=
for _ in $(seq 1 120); do
  src=$(curl -sS --max-time 60 "$api/session/$session/source" || true)
  if ! grep -q 'Loading from Metro' <<<"$src" && grep -qE 'XCUIElementType(Button|TextField)' <<<"$src"; then ready=1; break; fi
  sleep 5
done
curl -sS -o /dev/null --max-time 60 -H 'content-type: application/json' \
  -d "{\"script\":\"mobile: terminateApp\",\"args\":[{\"bundleId\":\"$app\"}]}" "$api/session/$session/execute/sync" || true
curl -sS -o /dev/null -X DELETE "$api/session/$session"
[ -n "$ready" ] || { echo "the app did not finish loading from Metro within 10 minutes" >&2; exit 1; }
echo "app $app loaded its JavaScript; warm-up session closed"
