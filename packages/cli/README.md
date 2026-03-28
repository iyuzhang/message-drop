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
message-drop doctor
message-drop autostart enable
```

The global package includes its own runtime, so `message-drop start` works from any directory and does not require a source checkout.

## Development (from source)

From the repository root:

```bash
pnpm install
pnpm message-drop start
```
