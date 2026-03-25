# Message Drop V1 Design

## Goal

Deliver a single V1 release where three tracks are all baseline-usable:

1. PC distribution and installation via global Node CLI (`pnpm add -g message-drop`)
2. Public GitHub open-source release readiness (README + repository governance + packaging hygiene)
3. Android baseline UI polish and in-app update prompt from GitHub Releases

## Scope

### In Scope

- Introduce a publishable CLI package for server startup and autostart management.
- Support autostart management on Windows and Linux.
- Add Android release-check capability (GitHub Releases latest version prompt).
- Improve mobile UI visual hierarchy and interaction affordance without changing core protocol.
- Prepare repository for public release with clear docs and safe ignore/publish rules.

### Out of Scope (V1)

- Desktop installer bundles (Electron/Tauri/MSI/DMG/DEB).
- iOS support.
- Mandatory in-place app auto-update installer flow.
- Non-systemd Linux autostart implementation beyond clear fallback guidance.

## Architecture

### High-level Modules

1. `packages/cli`
   - Owns user-facing CLI commands and npm distribution entry.
   - Reuses existing server runtime and web static assets.
2. `src` (existing backend)
   - Keeps existing message and file APIs.
   - Exposes startup function consumable from CLI entrypoint.
3. `android`
   - Keeps native shell responsibilities (WebView host + app version source).
4. `web`
   - Owns mobile-focused visual refinements.
   - Owns release-check and update banner UI for Android WebView experience.
5. `.github` + root docs
   - Adds release workflow, issue templates, PR template, contribution docs.

### CLI Commands

- `message-drop start`
  - Starts server.
  - Supports `--host`, `--port`, `--data-dir`, `--open` options.
- `message-drop autostart enable`
  - Enables user-level autostart according to current platform.
- `message-drop autostart disable`
  - Disables autostart.
- `message-drop autostart status`
  - Shows whether autostart is currently enabled and where it is configured.
- `message-drop doctor`
  - Validates runtime environment (Node version, write permissions, data dir, likely conflicts).
  - Stays minimal in V1 and focused on install/start troubleshooting only.

## Platform Autostart Design

### Linux

- Preferred mechanism: `systemd --user`.
- Generate user service file under user config path and execute `systemctl --user enable --now`.
- Status checks via `systemctl --user is-enabled` and service existence.
- If user systemd is unavailable: return actionable guidance and non-zero command exit.

### Windows

- Preferred mechanism: Startup folder shortcut to CLI start command.
- Manage per-user startup entry only (no admin requirement).
- Status check verifies shortcut existence and target integrity.

### Unsupported Platforms

- For unsupported platforms (for example `darwin`), autostart subcommands must:
  - Return a deterministic non-zero exit code.
  - Print a fixed "autostart is not supported on this platform in V1" message.
  - Avoid writing any partial config files or startup artifacts.
- `autostart status` must return an explicit `unsupported` state on unsupported platforms.

### Provider Abstraction

Implement `AutostartProvider` interface:

- `enable(): Promise<AutostartResult>`
- `disable(): Promise<AutostartResult>`
- `status(): Promise<AutostartStatus>`

Use provider factory with platform detection (`process.platform`) to isolate OS-specific logic.

## Android Update Prompt Design

### Data Source

- GitHub Releases API endpoint for latest stable release.
- Parse semantic version from release `tag_name` (for example `v1.2.3`).
- V1 release process publishes Android APK as a GitHub Release asset.

### Behavior

- Web app load in Android WebView triggers async release check (non-blocking).
- If latest release version > current app version:
  - Show update banner with concise message.
  - Provide action button opening release page or direct APK asset URL.
- On network error, timeout, parse error, or API rate limit:
  - Fail silently for primary flow.
  - Optional local debug log only (no remote telemetry collection in V1).

### Caching and Rate Control

- Cache last check result in local storage with TTL to avoid repeated API calls.
- Apply basic retry/backoff only on transient failures.

## Mobile UI Baseline Polish

### Visual Objectives

- Better hierarchy for chat list, composer, and action controls.
- Improve touch friendliness and spacing for phone screens.
- Strengthen readability under Android WebView conditions.

### Planned Changes

- Normalize spacing/radius/font sizing through shared theme tokens.
- Improve message row style and metadata readability.
- Improve composer grouping and button affordance (clear visual action priority).
- Keep file/image attachment state display compact and readable.
- Preserve current behavior and APIs.

## Open-source Release Readiness

### Documentation

- Add root `README.md` with:
  - Product positioning and value.
  - Architecture and platform matrix.
  - Quick start (`pnpm add -g`, `message-drop start`).
  - Android install/update flow via GitHub Releases.
  - Troubleshooting and FAQ.

### Repository Governance

- Add/verify:
  - `LICENSE`
  - `CONTRIBUTING.md`
  - `.github/ISSUE_TEMPLATE/*`
  - `.github/PULL_REQUEST_TEMPLATE.md`
  - `SECURITY.md` (minimal policy)

### Packaging Hygiene

- Verify `.gitignore` excludes local runtime data, build outputs, and secrets.
- Verify npm publish package contents using whitelist fields/files.
- Add release checklist script for pre-release sanity checks.
- Document that the published package can be installed by npm-compatible clients (`pnpm`, `npm`, `yarn`).

## Error Handling

### CLI

- Return deterministic error codes for:
  - invalid arguments
  - port conflicts
  - permission denied
  - unsupported autostart environment
- Print concise actionable remediation messages.

### Android Update Check

- Never break messaging flow due to update-check failures.
- Emit safe fallback state and optional debug log.

## Testing Strategy (No Physical Device Required)

### Automated

- CLI argument parsing and command dispatch tests.
- Autostart provider unit tests with mocked filesystem/process interactions.
- Release-check parser/version-compare unit tests.
- Web build and type checks.
- Existing verification scripts remain mandatory.

### Integration

- Start server via CLI and verify health/message endpoints.
- Simulate release-check API responses (new version, same version, invalid payload, timeout).

### CI

- Required jobs:
  - typecheck
  - web build
  - backend verify scripts
  - Android APK build (no ADB install step)
  - release dry-run validation

## Definition of Done

- `pnpm add -g message-drop` yields usable `message-drop` command.
- `message-drop start` reliably starts server and prints reachable URL.
- `autostart enable|disable|status` works on Windows and Linux (user-level mode).
- `autostart` commands show deterministic `unsupported` behavior on non-target desktop platforms.
- WebView UI shows update prompt when newer GitHub release exists via a single web-owned implementation path.
- Mobile UI baseline polish is visible and stable.
- Public repository docs/governance files are complete and coherent.
- CI passes without requiring physical phone connection.

## Delivery Plan (Task Buckets)

1. CLI packaging and command system.
2. Linux/Windows autostart providers and tests.
3. Android release-check + update prompt integration.
4. Mobile UI polish pass.
5. Open-source docs/governance and release pipeline.
6. End-to-end verification and release checklist execution.

## Risks and Mitigations

- GitHub API limit risk:
  - Mitigate with local cache TTL and fallback behavior.
- Linux environment variance:
  - Explicitly support systemd user mode in V1; report unsupported environments clearly.
- Windows startup path differences:
  - Use user startup folder API-resolved path and verify after write.

## Acceptance Notes

- Physical-device ADB runtime validation is explicitly not required for this phase.
- Deliverable must still include APK build verification in CI/local scripts.
