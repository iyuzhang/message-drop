# Message Drop Handover

## 1) Current State

- Phase 1-10 verification is implemented.
- Root validation commands now include:
  - `pnpm run typecheck`
  - `pnpm run verify:all`
  - `pnpm run verify:adb-smoke` (optional, local device only)
- The project now includes:
  - publishable CLI workspace under `packages/cli`
  - `message-drop start`
  - `message-drop autostart enable|disable|status`
  - `message-drop doctor`
  - Android GitHub release update prompt
  - open-source docs/governance files
  - CI and release workflows

## 2) Repository / Runtime Shape

- Root workspace package: `message-drop-workspace`
- CLI package: `packages/cli` with published name `message-drop`
- Server entry:
  - dev/root: `pnpm run start`
  - CLI/shared bootstrap: `src/start-server.ts`
- Android app package: `com.messagedrop.android`
- Default server bind:
  - host: `0.0.0.0`
  - port: `8787`

## 3) Latest Verified Behaviors

### Server and discovery

- Android discovery has been re-verified on device.
- Healthy discovery log sequence:
  - `mdns resolved host=... port=8787`
  - `discovery success endpoint=http://...:8787`
  - `loadEndpoint baseUrl=http://...:8787`
- UDP timeout logs are still acceptable if mDNS already succeeded first.

### Android / mobile UI

- New adaptive launcher icon has been added.
- Android WebView file chooser bridge works.
- Mobile layout was reworked for:
  - stacked composer
  - larger touch targets
  - update banner styling
  - attachment strip
- The bottom-bar overlap issue required two fixes:
  1. web-side viewport / bottom inset CSS variables
  2. Android native window inset handling in `MainActivity`
- Message list order is now oldest-first (older messages at top, newer at bottom).

### Release / update prompt

- Web layer owns update-check logic.
- Android exposes current app version through `MessageDropAndroid.getAppVersion()`.
- GitHub release prompt depends on `VITE_RELEASE_GITHUB_REPO`.

### CLI

- `message-drop start` is working from the repo-linked CLI flow.
- `message-drop doctor` checks:
  - Node version
  - effective messages/files paths
  - writability guidance
  - port guidance
- Linux autostart now writes a user systemd unit before enabling it.

## 4) Known Constraints / Caveats

- The phone app showing **"Waiting for server"** usually means the PC server is not running, not discoverable, or not on the same LAN.
- For local phone testing, keep the server process running:

```bash
pnpm run start
```

- If Clash TUN is enabled, LAN discovery may degrade. Prefer system proxy mode during local testing.
- `verify:all` does **not** include `verify:adb-smoke` because CI has no real device.
- Release check is resilient, but still depends on:
  - semver-like release tags such as `v1.2.3`
  - reachable GitHub API
  - configured `VITE_RELEASE_GITHUB_REPO`
- `/debug` is intentionally unauthenticated and should stay on trusted local/LAN environments only.

## 5) Recommended Verification Commands

### Full local gate

```bash
pnpm run typecheck
pnpm run verify:all
```

### Phone / Android

```bash
pnpm run verify:phase6
pnpm run verify:adb-smoke
adb install -r "android/app/build/outputs/apk/debug/app-debug.apk"
adb shell am start -W -n com.messagedrop.android/.MainActivity
```

### Daily development

```bash
pnpm run start
```

If the phone still cannot connect after install/relaunch, check:

```bash
adb logcat -d MessageDrop:I "*:S"
```

## 6) Important Files to Know

- `src/start-server.ts`
  - shared server bootstrap used by root server and CLI
- `packages/cli/src/index.ts`
  - CLI command router
- `packages/cli/src/commands/autostart.ts`
  - autostart command surface
- `packages/cli/src/autostart/providers/linux-systemd.ts`
  - Linux autostart unit generation + enable/disable
- `packages/cli/src/commands/doctor.ts`
  - local environment diagnostics
- `web/src/release.ts`
  - GitHub release-check logic, cache, retry, version compare
- `web/src/App.tsx`
  - mobile UI composition, update banner, composer UI
- `web/src/useMessagePool.ts`
  - WebSocket merge/sort behavior
- `android/app/src/main/java/com/messagedrop/android/MainActivity.kt`
  - discovery, WebView bridge, native window inset handling
- `scripts/verify-phase7-cli.ts`
- `scripts/verify-phase8-release-check.ts`
- `scripts/verify-phase9-open-source.ts`
- `scripts/verify-phase10-release-workflow.ts`
- `scripts/verify-adb-smoke.sh`

## 7) Documentation Status

### Already updated

- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- root `LICENSE`
- `.github` issue / PR templates

### Why this handover was refreshed

- The previous handover only reflected Phase 1-6.
- It did not mention:
  - CLI workspace
  - autostart
  - doctor
  - release-check
  - CI / release workflows
  - ADB smoke verification
  - latest mobile UI / icon / Android inset fixes

## 8) Recommended Next Tasks

1. Image/file message UX
   - render image thumbnails in the list instead of plain download-only rows
2. Upload reliability
   - progress, error state, retry
3. Connection transparency
   - show connection source (`mDNS`, `UDP`, `Manual`) in mobile UI
4. Release readiness polish
   - align npm publish versioning with git tags
   - decide whether release workflow should run `verify:all` before publish
5. Optional frontend tests
   - current web gate is build + custom verify scripts, not component/E2E tests

## 9) Handover Verdict

- Safe to continue development from the current worktree state.
- The highest-value missing context has now been documented here.
- If the next session starts with a mobile bug, re-check:
  - whether the PC server is actually running
  - `adb logcat -d MessageDrop:I "*:S"`
  - current LAN / proxy / TUN conditions
