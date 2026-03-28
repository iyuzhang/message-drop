# Contributing to message-drop

Thanks for helping improve message-drop. This document describes how we expect changes to be proposed and reviewed.

## Before you start

- Open an issue (bug report or feature request) when the change is non-trivial so maintainers can agree on direction.
- For security-sensitive reports, use [SECURITY.md](./SECURITY.md) instead of a public issue.

## Development setup

1. Clone the repository.
2. Install dependencies: `pnpm install`
3. Run the server: `pnpm message-drop start --foreground`
4. For the web app in dev mode: `pnpm --dir web dev`
5. Before opening a PR, run the full verification suite: `pnpm run verify:all`

## Pull requests

- Keep commits focused and the PR description explicit about **what** changed and **why**.
- Match existing code style (TypeScript, formatting, naming).
- Add or adjust tests/scripts only when your change affects behavior that is already covered or should be covered by verification.
- Ensure `pnpm run verify:all` passes locally.

## CLI package

The published npm binary lives under `packages/cli`. After changing CLI sources, run `pnpm --dir packages/cli run build` and verify daemon lifecycle from a global install (`message-drop start`, `message-drop status`, `message-drop stop`, `message-drop doctor`).

## Code of conduct

Be respectful and assume good intent. Harassment and abuse are not acceptable.
