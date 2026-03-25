# Message Drop Windows User Installer Design

## Goal

Deliver a Windows-first installation flow that behaves like a background service for end users:

1. Ship a user-level installer package (`.exe` as primary output) with bundled runtime.
2. Run Message Drop server silently after login, with tray controls for lifecycle and quick actions.
3. Avoid conflicts with existing system Node.js environments.

## Scope

### In Scope

- Add a Windows desktop helper process with tray integration.
- Bundle runtime privately under app installation directory (no global PATH mutation).
- Manage user-level auto-start and background process lifecycle.
- Provide one-click actions from tray: open web UI, start/stop service, open data folder, quit.
- Add build scripts and CI-ready packaging entry for Windows installer artifact.
- Document install, upgrade, uninstall, and troubleshooting paths.

### Out of Scope (This Iteration)

- System-wide Windows Service mode requiring admin privileges.
- In-app delta auto-update mechanism.
- macOS/Linux desktop installer parity.
- Enterprise policy integration (GPO, SCCM, Intune managed deployment).

## Architecture

### High-Level Components

1. `packages/windows-agent` (new)
   - Owns tray app lifecycle and user-facing desktop integration.
   - Starts/stops background Message Drop server child process.
   - Reads and writes user-level runtime config.
2. Existing backend `src/start-server.ts` and server runtime
   - Remains the single source of truth for server behavior.
   - Is launched by the desktop agent in packaged mode.
3. Existing web bundle `web/dist`
   - Served by existing server.
   - Opened in default browser by tray action.
4. Installer build pipeline
   - Produces Windows user installer artifact.
   - Installs app into user-writable location (no admin required by default).

### Runtime Isolation (No Node Conflict)

- Desktop package must use private runtime shipped with the app.
- Startup command must resolve local executable path, never `node` from system PATH.
- Installer must not register or overwrite global `node.exe`.
- Agent launches the server via absolute app-owned executable/runtime path and avoids shell path resolution.
- Child process environment must not require system-installed Node.js.
- Uninstall must remove only app-owned runtime files.

## User Experience

### Install

- User runs installer `.exe`.
- Installer writes app files to user scope directory.
- Installer registers user-level autostart by default (silent, no post-install prompt).
- User can toggle autostart later from tray menu.

### Background Lifecycle

- On login, tray helper starts silently.
- Tray icon indicates running state:
  - Running: server healthy and URL reachable.
  - Stopped/error: actionable status in tray menu.

### Tray Menu Contract

- `Open Message Drop` (launch browser to local URL).
- `Start Server` / `Stop Server` (toggle depending on current state).
- `Open Data Folder`.
- `Autostart: On/Off` toggle (user-level).
- `Quit` (stops helper and server together; no detached server mode in v1).
- When in error state, include `Retry Start` and `View Logs`.

## Process and Failure Handling

### Start Sequence

1. Resolve runtime/config/data paths from user profile.
2. Spawn server child process in detached/background-safe mode.
3. Wait for health/readiness signal (URL reachable or startup log marker).
4. Publish status to tray state.

### Stop Sequence

1. Request graceful shutdown of server child.
2. Wait bounded time for exit.
3. Force terminate only when graceful stop times out.

### Failure Recovery

- If startup fails, tray switches to error state with "View Logs" and "Retry Start".
- Crash loop protection: bounded restart attempts with cooldown.
- Port conflict surfaced as explicit tray error hint.

## Security and Data Boundaries

- Keep LAN-only trust model unchanged from current project security posture.
- No privilege escalation: user-level install and startup only.
- Store logs/config/data under user profile paths.
- Never expose diagnostics endpoint or logs beyond local machine by default.

## Verification Strategy

### Automated

- Unit tests:
  - tray menu state mapping
  - autostart enable/disable/status behavior
  - child process supervisor restart/cooldown logic
- Integration tests:
  - launch helper -> server starts -> health success
  - stop helper -> child exits
  - autostart registration artifacts written/removed correctly
- Packaging checks:
  - installer artifact generated
  - installed app starts without requiring global Node.js

### Manual

- Fresh Windows VM:
  - install -> login -> tray appears
  - Open Message Drop works
  - Start/Stop works
  - uninstall removes app binaries and startup entries

## Rollout and Compatibility

- Windows installer flow is additive and does not modify existing developer workflows.
- If tray helper is unavailable, users can still run `message-drop start` manually.
