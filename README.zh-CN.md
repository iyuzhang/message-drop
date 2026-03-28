# Message Drop

> 🌐 English version: [README.md](./README.md)

**受够了传个文件还要先扫码登录？受够了发段文本还得先加好友、建房间？**

我们在局域网里需要的，只是一个“打开就能发，发完就能看”的公共剪贴板。**Message Drop** 就是为此而生：零账号、零配对、零负担。局域网内的所有设备共享一个消息池，打开网页或 App，输入内容，回车，搞定。

## ✨ 核心亮点

- 🚀 **极速可用**：没有繁琐的注册登录和设备配对流程，即开即用。
- 🪶 **极致轻量**：基于 Node.js ([Hono](https://hono.dev/) + `ws`) 与 React 构建，摒弃臃肿的框架与重型数据库。
- 🔒 **隐私与安全**：纯局域网离线运行，数据绝不上云。支持为单条消息添加 PIN 码锁。
- 📱 **多端无缝互联**：提供 Windows 傻瓜式安装包、Android 客户端（支持 mDNS 自动发现服务），以及跨平台的现代 Web UI。

## 📦 快速开始 / 安装与使用

### 1. Windows 安装包（托盘模式）

如果你使用 Windows，这是最推荐的方式，几乎“零配置”。

- **下载地址**：前往 [GitHub Releases](https://github.com/iyuzhang/message-drop/releases) 下载最新的 `windows-agent Setup.exe`。
- **特性**：安装后在系统托盘静默运行，默认开机自启，不污染全局 Node.js 环境变量。

### 2. 移动端首选：Android App

- **下载地址**：在 [GitHub Releases](https://github.com/iyuzhang/message-drop/releases) 下载最新 APK。
- **特性**：打开 App 即可通过 mDNS/UDP 自动发现局域网内的 Message Drop 服务并连接。

### 3. 全局安装 CLI（npm/pnpm）

日常使用建议直接全局安装：

```bash
npm install -g message-drop@latest
# 或
pnpm add -g message-drop
```

启动服务：

```bash
message-drop start
```

其他实用命令：

```bash
message-drop doctor           # 环境诊断与路径查看
message-drop status           # 查看后台守护进程状态
message-drop stop             # 停止后台守护进程
message-drop autostart enable # 设置开机自启 (支持 Linux systemd / Windows 启动项)
```

### 4. 开发模式（源码仓库）

```bash
pnpm install
pnpm message-drop start
```

其他开发命令：

```bash
pnpm message-drop doctor
pnpm --dir web run build
```

## 🛠️ 故障排查


| 现象                                | 建议处理                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| 其他设备无法访问服务                        | 确认服务监听 `0.0.0.0`，并检查电脑防火墙是否放通了对应的 `PORT`（默认 8787）。                 |
| Android 一直显示 `Waiting for server` | 1. 确认电脑端服务已启动；2. 确认手机和电脑在同一局域网；3. 检查路由器是否禁用了 mDNS/UDP 广播。          |
| 服务发现不稳定                           | 可长按手机端顶部状态栏，手动输入电脑的 IP 和端口直连。电脑端可运行 `message-drop doctor` 查看可用 IP。 |


*开发人员可选的真机冒烟测试：*

```bash
pnpm run verify:adb-smoke
```

