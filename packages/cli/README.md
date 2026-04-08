# message-drop CLI

`message-drop` is the command-line runtime for Message Drop.

## Install

```bash
npm install -g message-drop@latest
# or
pnpm add -g message-drop
```

## Use

```bash
message-drop start
message-drop status
message-drop stop
message-drop auth reset
message-drop doctor
message-drop autostart enable
```

The global package includes its own runtime, so `message-drop start` works from any directory and does not require a source checkout. By default it starts in background daemon mode and opens the local URL in your browser (best-effort).

## Development (from source)

From the repository root:

```bash
pnpm install
pnpm message-drop start
```
