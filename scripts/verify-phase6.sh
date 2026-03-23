#!/usr/bin/env bash
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/home/yuzhang/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

cd /home/yuzhang/iyuzhang/rh_repo/message-drop/android
./gradlew --no-daemon assembleDebug

echo "Phase 6 verification: OK"
