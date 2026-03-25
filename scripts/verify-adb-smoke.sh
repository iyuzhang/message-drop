#!/usr/bin/env bash
set -euo pipefail

skip() {
  echo "[verify-adb-smoke] skipped: $*"
  exit 0
}

if ! command -v adb >/dev/null 2>&1; then
  skip "adb not installed"
fi

device_count=$(adb devices 2>/dev/null | awk 'NR>1 && $2 == "device" { n++ } END { print n + 0 }')
if [[ "${device_count}" -eq 0 ]]; then
  skip "no device connected (ready state)"
fi

echo "[verify-adb-smoke] device(s) ready: ${device_count}"

model=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r\n' || true)
if [[ -z "${model}" ]]; then
  echo "[verify-adb-smoke] error: failed to read ro.product.model" >&2
  exit 1
fi
echo "[verify-adb-smoke] ro.product.model=${model}"

pkg_line=$(adb shell pm path com.messagedrop.android 2>/dev/null | head -1 | tr -d '\r\n' || true)
if [[ "${pkg_line}" == package:* ]]; then
  echo "[verify-adb-smoke] com.messagedrop.android: ${pkg_line}"
else
  echo "[verify-adb-smoke] note: com.messagedrop.android not installed on device (optional)"
fi

echo "[verify-adb-smoke] ok"
