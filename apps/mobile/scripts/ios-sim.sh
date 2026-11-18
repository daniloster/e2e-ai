#!/usr/bin/env bash
# Builds a Release app for the iOS simulator (the JS bundle is inside, so no Metro is needed) and
# installs and launches it on ONE simulator, so other simulators (a Debug build with the DEV icon,
# another session's install) are left alone. Xcode 27 shows simulators in DeviceHub
# (Xcode.app/Contents/Applications/DeviceHub.app); there is no Simulator.app any more.
#
# Usage: scripts/ios-sim.sh ["<simulator name or UDID>"]   (or PN_SIM=...; default "iPhone 17")
# The simulator is booted if it is not running yet.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-${PN_SIM:-iPhone 17}}"

# Resolve a name or UDID to one UDID, preferring a booted device with that name.
devices=$(xcrun simctl list devices available)
if [[ "$target" =~ ^[0-9A-F-]{36}$ ]]; then
  id="$target"
else
  id=$(grep -F "    $target (" <<<"$devices" | grep '(Booted)' | grep -oE '[0-9A-F-]{36}' | head -1 || true)
  [ -z "$id" ] && id=$(grep -F "    $target (" <<<"$devices" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
fi
if [ -z "${id:-}" ]; then
  echo "No simulator named \"$target\". Available:" >&2
  grep -E '^    ' <<<"$devices" >&2
  exit 1
fi
xcrun simctl bootstatus "$id" -b >/dev/null

xcodebuild -workspace ios/PocketNotes.xcworkspace -scheme PocketNotes -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build/simrel build -quiet

app=ios/build/simrel/Build/Products/Release-iphonesimulator/PocketNotes.app
xcrun simctl install "$id" "$app"
xcrun simctl launch "$id" com.pocketnotes >/dev/null
echo "Installed and launched on $target ($id)"
open /Applications/Xcode.app/Contents/Applications/DeviceHub.app
