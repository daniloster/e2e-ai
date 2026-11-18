#!/usr/bin/env bash
# Opens a Pocket Notes deep link on a booted iOS simulator or a connected Android device/emulator.
#
# Usage: scripts/deep-link.sh <ios|android> <link>
#   link may be:
#     - a custom-scheme URI:      pocketnotes://s#<payload>
#     - a share link:             https://pocketnotes.app/s#<payload>  (Universal Link / App Link)
#     - a bare path (+fragment):  s#<payload>  -> pocketnotes://s#<payload>
#     - a bare share payload:     #<payload> or <payload> -> pocketnotes://s#<payload>
#     - the word sample:          a built-in valid payload (a 24-block board)
#
# Examples:
#   scripts/deep-link.sh ios sample
#   scripts/deep-link.sh ios "#AQAAGA"
#   scripts/deep-link.sh android "https://pocketnotes.app/s#AQAAGA"
#
# iOS targets the booted simulator; when more than one is booted, set PN_IOS_DEVICE to its UDID
# (`xcrun simctl list devices booted`). Android targets the only device, or ANDROID_SERIAL.
#
# Set PN_SITE_HOST to try another host for https links (default pocketnotes.app).
set -euo pipefail

SCHEME="pocketnotes"
# Debug builds are com.pocketnotes.dev on both platforms:
#   IOS_BUNDLE_ID=com.pocketnotes.dev ANDROID_PACKAGE=com.pocketnotes.dev scripts/deep-link.sh ...
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-com.pocketnotes}"
ANDROID_PACKAGE="${ANDROID_PACKAGE:-com.pocketnotes}"
SITE_HOST="${PN_SITE_HOST:-pocketnotes.app}"
IOS_DEVICE="${PN_IOS_DEVICE:-booted}"
# encodeShare({ blocks: 24 }) from @pn/core (apps-modules/core/src/codec.ts)
SAMPLE_PAYLOAD="AQAAGA"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

if [ $# -ne 2 ]; then
  usage
fi

PLATFORM="$1"
LINK="$2"

case "$LINK" in
  sample) URI="${SCHEME}://s#${SAMPLE_PAYLOAD}" ;;
  "$SCHEME://"*) URI="$LINK" ;;
  "https://$SITE_HOST/"* | "https://www.$SITE_HOST/"*) URI="$LINK" ;;
  https://* | http://*)
    echo "error: only https://$SITE_HOST links and $SCHEME:// URIs open the app" >&2
    exit 1
    ;;
  "#"*) URI="${SCHEME}://s${LINK}" ;;
  s | s#* | /s | /s#*) URI="${SCHEME}://${LINK#/}" ;;
  *[!A-Za-z0-9_-]*)
    echo "error: not a share link or payload: $LINK" >&2
    exit 1
    ;;
  *) URI="${SCHEME}://s#${LINK}" ;;
esac

case "$PLATFORM" in
  ios)
    if ! command -v xcrun >/dev/null 2>&1; then
      echo "error: xcrun not found - Xcode command line tools required" >&2
      exit 1
    fi
    BOOTED_COUNT=$(xcrun simctl list devices booted | grep -c "(Booted)" || true)
    if [ "$BOOTED_COUNT" -eq 0 ]; then
      echo "error: no booted iOS simulator - start one first" >&2
      exit 1
    fi
    if [ "$BOOTED_COUNT" -gt 1 ] && [ "$IOS_DEVICE" = "booted" ]; then
      echo "warning: $BOOTED_COUNT simulators are booted; set PN_IOS_DEVICE=<udid> to pick one" >&2
    fi
    if ! xcrun simctl get_app_container "$IOS_DEVICE" "$IOS_BUNDLE_ID" >/dev/null 2>&1; then
      echo "warning: $IOS_BUNDLE_ID is not installed on simulator $IOS_DEVICE" >&2
    fi
    echo "Opening $URI on the iOS simulator ($IOS_DEVICE)..."
    # iOS 26+ asks "Open in “Pocket Notes”?" first; confirm it in the Simulator window.
    xcrun simctl openurl "$IOS_DEVICE" "$URI"
    ;;
  android)
    if ! command -v adb >/dev/null 2>&1; then
      echo "error: adb not found - Android platform-tools required" >&2
      exit 1
    fi
    if [ -z "$(adb devices | grep -w device || true)" ]; then
      echo "error: no connected Android device/emulator - start one first" >&2
      exit 1
    fi
    echo "Opening $URI on the Android device/emulator..."
    # Quoted for the device shell, so the # fragment survives.
    adb shell am start -W -a android.intent.action.VIEW -d "'$URI'" "$ANDROID_PACKAGE"
    ;;
  *)
    usage
    ;;
esac
