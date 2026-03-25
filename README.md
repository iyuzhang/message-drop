# message-drop

**message-drop** is a small stack for **LAN file and message sharing**: a Node.js server (HTTP + WebSockets + optional mDNS discovery), a browser UI, and an Android app that wraps the same UI. Use it on a trusted local network to exchange short messages and files between devices without a central cloud service.

**Keywords:** local network, LAN messaging, peer-friendly sharing, WebSocket fan-out, self-hosted, offline-first LAN, home lab.

## Architecture and platforms

| Layer | Where it runs | Stack / notes |
|--------|----------------|---------------|
| Server | Linux, macOS, Windows (Node.js) | [Hono](https://hono.dev/) HTTP API, `ws` for live updates, optional Bonjour/mDNS for discovery |
| Web UI | Modern browsers | Vite + React; talks to the server on your LAN |
| CLI | Same machines as server (Node.js) | `message-drop` — `start`, `doctor`, `autostart` |
| Android | Android 8+ (typical) | WebView + native bridge; APK distributed via **GitHub Releases** |

The server stores messages and uploaded files under configurable paths (see environment variables in source: `PORT`, `HOST`, `MESSAGE_DROP_DATA_PATH`, `MESSAGE_DROP_FILES_DIR`).

## Quick start (from a git checkout)

Prerequisites: [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm start
```

Then open the URL printed in the log (defaults to port **8787**).

Build the web UI when you need a production bundle:

```bash
pnpm --dir web run build
```

Recommended local verification gate:

```bash
pnpm run typecheck
pnpm run verify:all
```

## Global install and `start`

Build and link the CLI from the repo root:

```bash
pnpm install
pnpm --dir packages/cli run build
pnpm add -g ./packages/cli
```

Run the server (expects a full checkout with `src/server.ts` next to `pnpm-workspace.yaml`):

```bash
message-drop start
```

Use `message-drop doctor` if `start` cannot find the workspace or runtime tools.

## Android: install and update via GitHub Releases

1. Open your project’s **Releases** page on GitHub.
2. Download the latest **APK** asset and install it (you may need to allow installs from unknown sources).
3. For update prompts inside the app, set build-time env **`VITE_RELEASE_GITHUB_REPO`** to `owner/repo` (same repository that publishes releases). The web client compares the app version to the latest release tag.

Release automation is project-specific; this repo is set up so the client can check `https://api.github.com/repos/<owner>/<repo>/releases/latest` when that variable is configured.

## Windows user installer (tray mode)

Use the Windows installer to run Message Drop in user-level tray mode without manually setting up Node.js tooling.

### Install (user-level)

1. Download the latest Windows installer from your GitHub Release assets.
2. Run the installer from your Windows user session.
3. Complete the setup wizard. The app installs into your user scope and starts the tray agent.

### Startup and autostart behavior

- The tray agent performs silent startup after sign-in.
- Autostart is enabled by default at install time.
- If the tray icon is hidden, open the Windows notification overflow area to confirm the agent is running.

### Upgrade path

- Install a newer release over the existing installation.
- User-level settings and runtime data are preserved across normal upgrades.
- After upgrading, sign out and sign in (or restart Windows) to confirm startup behavior if needed.

### Uninstall behavior

- Uninstall from Windows Apps settings or the installer's uninstall entry.
- User-level startup artifacts and tray startup registration are removed.
- Runtime data/logs may remain for troubleshooting unless explicitly removed.

### Runtime isolation and system impact

- The installer uses private app-owned runtime paths under the current user profile.
- No global Node.js installation is modified.
- No system-wide PATH mutation is required for tray mode operation.

### Troubleshooting

- **Port conflict:** If tray status shows an error and logs indicate the configured port is already in use, stop the conflicting process or adjust server port configuration.
- **Startup disabled:** If startup does not occur after sign-in, check Startup Apps settings and re-enable Message Drop autostart from the tray menu.
- **Manual CLI fallback:** For manual recovery, run the project server directly from a repo checkout using `pnpm start` (or use the existing CLI workflow where available).

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Other devices cannot reach the server | Ensure the server binds to `0.0.0.0` (default) or your LAN IP; check firewall rules for the chosen **PORT**. |
| Android app shows `Waiting for server` | First confirm the host server is actually running (`pnpm run start`). Then check same-LAN connectivity and inspect `adb logcat -d MessageDrop:I "*:S"` for `mdns resolved` / `discovery success` logs. |
| Discovery does not show the service | mDNS is LAN- and OS-dependent; you can still connect by URL/IP. Run `message-drop doctor` on the host. |
| CLI says it cannot find the workspace | Run `message-drop start` from an install that was linked from a **full** clone (not a standalone tarball of `packages/cli` alone). |
| Linux autostart / systemd | `message-drop autostart enable` writes a **user** unit under `~/.config/systemd/user/` (or `$XDG_CONFIG_HOME/systemd/user/`) and runs `message-drop start`. `disable` turns off the unit but leaves the file unless you remove it. |
| Android update check never appears | Confirm `VITE_RELEASE_GITHUB_REPO` was set at build time and that releases use semver-style tags (e.g. `v1.2.3`). |

For optional real-device smoke verification:

```bash
pnpm run verify:adb-smoke
```

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## License

ISC — see [LICENSE](./LICENSE).
