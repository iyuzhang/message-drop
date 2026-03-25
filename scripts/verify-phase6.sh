#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_PROJECT="$REPO_ROOT/android"

if [[ -n "${ANDROID_HOME:-}" ]]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

cd "$ANDROID_PROJECT"
./gradlew --no-daemon assembleDebug

echo "Phase 6 verification: OK"
