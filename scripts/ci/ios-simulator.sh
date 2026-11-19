#!/usr/bin/env bash
# CI: boots the newest available iPhone simulator and prints its UDID.
set -euo pipefail
udid=$(xcrun simctl list devices available -j | node -e '
  const all = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
  const ios = Object.entries(all)
    .filter(([runtime]) => runtime.includes("iOS"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));
  for (const [, devices] of ios) {
    const phone = devices.find((d) => /^iPhone \d+( Pro)?$/.test(d.name)) ?? devices.find((d) => d.name.startsWith("iPhone"));
    if (phone) { console.log(phone.udid); process.exit(0); }
  }
  process.exit(1);')
xcrun simctl boot "$udid" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$udid" -b >/dev/null
echo "$udid"
