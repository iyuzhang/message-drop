# message-drop

**English:** `message-drop` is a lightweight stack for **LAN file and message sharing**: a Node.js server (HTTP + WebSockets + optional mDNS discovery), a browser UI, and an Android app wrapper.  
**中文：**`message-drop` 是一个轻量级 **局域网消息与文件共享** 工具集：包含 Node.js 服务端（HTTP + WebSocket + 可选 mDNS 发现）、浏览器 UI，以及 Android WebView 客户端。

**Keywords:** local network, LAN messaging, peer-friendly sharing, WebSocket fan-out, self-hosted, offline-first LAN, home lab.

## Architecture and platforms / 架构与平台

| Layer | Where it runs | Stack / notes |
|--------|----------------|---------------|
| Server | Linux, macOS, Windows (Node.js) | [Hono](https://hono.dev/) HTTP API, `ws` for live updates, optional Bonjour/mDNS for discovery |
| Web UI | Modern browsers | Vite + React; talks to the server on your LAN |
| CLI | Same machines as server (Node.js) | `message-drop` — `start`, `doctor`, `autostart` |
| Android | Android 8+ (typical) | WebView + native bridge; APK distributed via **GitHub Releases** |

**English:** The server stores messages and uploaded files under configurable paths (`PORT`, `HOST`, `MESSAGE_DROP_DATA_PATH`, `MESSAGE_DROP_FILES_DIR`).  
**中文：**服务端会将消息与上传文件保存到可配置路径（`PORT`、`HOST`、`MESSAGE_DROP_DATA_PATH`、`MESSAGE_DROP_FILES_DIR`）。

## Quick start (from a git checkout) / 快速开始（源码方式）

**Prerequisites / 前置条件：** [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm start
```

**English:** Open the URL printed in the log (default port `8787`).  
**中文：**打开终端输出的地址（默认端口 `8787`）。

Build web UI production bundle / 构建 Web 生产包：

```bash
pnpm --dir web run build
```

Recommended verification gate / 建议发布前校验：

```bash
pnpm run typecheck
pnpm run verify:all
```

## Global install and `start` / 全局安装与启动

Install CLI from npm / 通过 npm 全局安装 CLI：

```bash
pnpm add -g message-drop
```

Run server / 启动服务：

```bash
message-drop start
```

Health check / 诊断命令：

```bash
message-drop doctor
```

For local development from a checkout, you can still build and link the CLI / 本地开发时也可使用源码 link 方式：

```bash
pnpm install
pnpm --dir packages/cli run build
pnpm add -g ./packages/cli
```

## Android: install and update via GitHub Releases / Android 安装与更新

1. Open Releases page / 打开 Releases 页面。  
2. Download latest APK and install / 下载最新 APK 并安装（可能需要允许未知来源安装）。  
3. Set build-time env `VITE_RELEASE_GITHUB_REPO=owner/repo` for in-app update prompt / 如需 App 内更新提示，构建时设置 `VITE_RELEASE_GITHUB_REPO=owner/repo`。

## Windows user installer (tray mode) / Windows 安装包（托盘模式）

Use the Windows installer to run Message Drop in user-level tray mode / 使用 Windows 安装包以用户级托盘模式运行 Message Drop。

### Install (user-level) / 安装（用户级）

1. Download installer from GitHub Releases / 从 GitHub Releases 下载：
   - Latest releases: [https://github.com/iyuzhang/message-drop/releases](https://github.com/iyuzhang/message-drop/releases)
   - Current installer release: [Windows Installer v1.0.0](https://github.com/iyuzhang/message-drop/releases/tag/win-v1.0.0)
2. Run installer in your Windows account / 在当前 Windows 用户会话中运行安装器。  
3. Finish setup wizard / 完成安装向导，程序会以托盘代理启动。

### Startup and autostart / 启动与自启动

- Silent startup after sign-in / 登录后静默启动  
- Autostart enabled by default / 默认启用开机自启  
- Check hidden tray icons if not visible / 图标隐藏时请展开系统托盘查看

### Upgrade and uninstall / 升级与卸载

- Install newer version in place / 覆盖安装新版本即可升级  
- User settings/data usually preserved / 用户级数据通常会保留  
- Uninstall via Windows Apps settings / 通过 Windows 应用设置卸载  
- Startup artifacts removed on uninstall / 卸载会移除自启动注册项

### Runtime isolation / 运行时隔离

- Uses private runtime paths under current user / 使用当前用户目录下的私有运行时路径  
- Does not modify global Node.js / 不修改全局 Node.js 环境  
- No system-wide PATH mutation required / 不需要改动系统级 PATH

## Troubleshooting / 故障排查

| Symptom / 现象 | What to try / 处理建议 |
|---------|-------------|
| Other devices cannot reach server / 其他设备连不上服务 | Ensure server binds `0.0.0.0` and firewall allows selected `PORT`. / 确认服务监听 `0.0.0.0`，并放通对应端口防火墙。 |
| Android shows `Waiting for server` / Android 显示等待服务 | Confirm host is running (`pnpm run start`), then check same LAN and run `adb logcat -d MessageDrop:I "*:S"`. / 先确认主机服务已启动，再检查同一局域网和日志。 |
| Discovery fails / 服务发现失败 | mDNS may vary by network; connect by URL/IP and run `message-drop doctor`. / mDNS 受网络环境影响，可改用 URL/IP 并执行诊断。 |
| CLI cannot find workspace / CLI 找不到工作区 | Use npm global install path, or run from a full checkout if using linked CLI. / 优先使用 npm 全局安装；若用 link 方式需完整源码目录。 |
| Linux autostart issues / Linux 自启动问题 | `message-drop autostart enable` writes user systemd unit and enables it; `disable` turns it off. / `enable` 写入并启用用户级 systemd，`disable` 关闭。 |
| Android update check missing / Android 无更新提示 | Ensure `VITE_RELEASE_GITHUB_REPO` was set at build time and release tags follow semver. / 确认构建时已设置变量且 tag 符合 semver。 |

Optional real-device smoke test / 可选真机冒烟测试：

```bash
pnpm run verify:adb-smoke
```

## Contributing and security / 贡献与安全

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).  
请参见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [SECURITY.md](./SECURITY.md)。

## License / 许可证

GPL-3.0 — see [LICENSE](./LICENSE).  
GPL-3.0 —— 详见 [LICENSE](./LICENSE)。
