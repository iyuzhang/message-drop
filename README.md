# Message Drop

> 🇨🇳 Chinese version: [README.zh-CN.md](./README.zh-CN.md)

**Tired of scanning QR codes and logging in just to send a file? Tired of adding contacts or creating rooms just to share a short text?**

What we really need on a local network is a shared clipboard that just works. **Message Drop** is built for exactly that: zero accounts, zero pairing, zero setup burden. All devices on your LAN share one message pool. Open the app or webpage, type, hit enter, done.

## ✨ Highlights

- 🚀 **Instantly usable**: No sign-up flow, no device pairing, no friction.
- 🪶 **Lightweight by design**: Built with Node.js ([Hono](https://hono.dev/) + `ws`) and React, without heavy frameworks or databases.
- 🔒 **Private and local**: Runs fully offline on your LAN. Your data does not go to third-party clouds. Supports optional per-message PIN lock.
- 📱 **Works across devices**: Includes a foolproof Windows installer, an Android app with mDNS discovery, and a modern cross-platform Web UI.

## 📦 Quick Start / Installation

### 1. Windows Installer (Tray Mode)

If you use Windows, this is the recommended path with near-zero setup.

- **Download**: Get the latest `windows-agent Setup.exe` from [GitHub Releases](https://github.com/iyuzhang/message-drop/releases).
- **Features**: Runs silently in the tray, auto-starts on boot, and does not interfere with your global Node.js environment.

## Windows User Installer (Tray Mode)

- Autostart is enabled by default at install time.
- Upgrade path: install a newer setup package over an existing installation.
- Uninstall behavior: removes tray app binaries; user data under app storage can be retained for safety.
- Private app-owned runtime paths are used for logs, pid, and message/file data.
- No global Node.js installation is modified.
- Port conflict: tray menu will expose retry/log guidance if service startup hits an in-use port.
- Startup disabled: you can toggle autostart from tray menu.
- Manual CLI fallback: advanced users can still run `message-drop` CLI directly.

### 2. Mobile First: Android App

- **Download**: Get the latest APK from [GitHub Releases](https://github.com/iyuzhang/message-drop/releases).
- **Features**: Automatically discovers and connects to Message Drop on your LAN via mDNS/UDP.

### 3. Global CLI Install (npm/pnpm)

For everyday use, install globally:

```bash
npm install -g message-drop@latest
# or
pnpm add -g message-drop
```

Start the server:

```bash
message-drop start
```

By default, `start` launches in background daemon mode and opens the local URL in your browser (best-effort).

Other useful commands:

```bash
message-drop doctor           # Diagnostics and path info
message-drop status           # Check background daemon status
message-drop stop             # Stop background daemon
message-drop autostart enable # Enable auto-start (Linux systemd / Windows startup)
```

### 4. Development Mode (from source checkout)

```bash
pnpm install
pnpm message-drop start
```

Other dev commands:

```bash
pnpm message-drop doctor
pnpm --dir web run build
```

## 🛠️ Troubleshooting

| Symptom | What to try |
| --- | --- |
| Other devices cannot reach the server | Ensure the server listens on `0.0.0.0` and your firewall allows `PORT` (default 8787). |
| Android keeps showing `Waiting for server` | 1) Ensure the host server is running. 2) Ensure phone and host are on the same LAN. 3) Check whether router blocks mDNS/UDP broadcast. |
| Discovery is unstable | Long-press the top status bar in Android app, then manually enter host IP and port. Run `message-drop doctor` on host to view usable IPs. |
| Connection/discovery breaks under VPN | Some VPN clients (especially `TUN` mode) may hijack routes or block LAN broadcast/mDNS. Try disabling VPN, switching to system-proxy mode, or adding LAN bypass/split-tunnel rules. |

*Optional real-device smoke test for developers:*

```bash
pnpm run verify:adb-smoke
```
