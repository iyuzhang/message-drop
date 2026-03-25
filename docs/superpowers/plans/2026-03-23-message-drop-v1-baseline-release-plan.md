# Message Drop V1 Baseline Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one V1 release where CLI distribution, Windows/Linux autostart, open-source readiness, and Android WebView UI/update prompt are all baseline-usable.

**Architecture:** Add a publishable CLI package that reuses existing server/web runtime, isolate autostart per OS provider, keep update-check ownership in the web layer (rendered inside Android WebView), and finish with repository governance + release automation. Use focused verify scripts and CI checks so delivery does not depend on ADB hardware.

**Tech Stack:** Node.js + TypeScript (`tsx`), Hono/ws backend, React/Vite frontend, Android WebView/Kotlin host, GitHub Actions.

---

## File Structure Map

- Create: `packages/cli/package.json` (must set `"name": "message-drop"`, `bin.message-drop`, and build script to produce `dist/index.js`)
- Create: `packages/cli/tsconfig.json` (CLI TypeScript project config)
- Create: `packages/cli/src/index.ts` (CLI command router)
- Create: `packages/cli/src/commands/start.ts` (server start command)
- Create: `packages/cli/src/commands/autostart.ts` (autostart command group)
- Create: `packages/cli/src/commands/doctor.ts` (environment diagnostics command)
- Create: `packages/cli/src/autostart/types.ts` (provider contracts)
- Create: `packages/cli/src/autostart/provider-factory.ts` (platform selection)
- Create: `packages/cli/src/autostart/providers/linux-systemd.ts` (Linux provider)
- Create: `packages/cli/src/autostart/providers/windows-startup.ts` (Windows provider)
- Create: `packages/cli/src/autostart/providers/unsupported.ts` (unsupported platform provider)
- Create: `packages/cli/src/utils/paths.ts` (runtime path helpers)
- Create: `src/start-server.ts` (shared server startup/shutdown API for CLI reuse)
- Modify: `src/server.ts` (call shared startup API)
- Modify: `package.json` (workspace setup + scripts)
- Create: `pnpm-workspace.yaml` (workspace declaration for root + CLI + web)
- Create: `scripts/verify-phase7-cli.ts` (CLI/autostart behavior verification)
- Create: `scripts/verify-phase8-release-check.ts` (release-check behavior verification)
- Create: `scripts/verify-phase9-open-source.ts` (docs/governance/readme verification)
- Create: `scripts/verify-phase10-release-workflow.ts` (workflow and verify-chain verification)
- Modify: `scripts/verify-phase4.ts` (UI token/regression assertion extension)
- Modify: `web/src/api.ts` (release metadata fetch helper)
- Create: `web/src/release.ts` (version parsing/comparison/cache)
- Modify: `web/src/types.ts` (release-check types as needed)
- Modify: `web/src/App.tsx` (update banner + mobile UI polish integration)
- Modify: `web/src/App.css` (tokenized mobile styling updates)
- Modify: `android/app/build.gradle.kts` (expose app version to web if needed)
- Modify: `android/app/src/main/java/com/messagedrop/android/MainActivity.kt` (inject version string to WebView context if needed)
- Create: `README.md` (public-facing project readme)
- Create: `LICENSE` (open-source license)
- Create: `packages/cli/README.md` (npm package readme)
- Create: `packages/cli/LICENSE` (npm package license file)
- Create: `CONTRIBUTING.md` (contribution guide)
- Create: `SECURITY.md` (security policy)
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/workflows/release.yml` (build web/server/apk + release artifacts)
- Create: `.github/workflows/ci.yml` (typecheck + verify pipeline on push/pr)
- Modify: `.gitignore` (final hygiene review)

## Task 1: Workspace and CLI Skeleton

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/start.ts`
- Create: `packages/cli/src/commands/autostart.ts` (stub in Task 1, full in Task 3)
- Create: `packages/cli/src/commands/doctor.ts` (stub in Task 1, full in Task 4)
- Test: `scripts/verify-phase7-cli.ts`

- [ ] **Step 1: Write the failing verification script for CLI command discovery**

```ts
// scripts/verify-phase7-cli.ts (initial failing assertion)
import { spawn } from 'node:child_process'
import { once } from 'node:events'

async function runHelp(): Promise<string> {
  const child = spawn('pnpm', ['--dir', 'packages/cli', 'exec', 'tsx', 'src/index.ts', '--help'])
  let out = ''
  child.stdout.on('data', (d) => (out += String(d)))
  child.stderr.on('data', (d) => (out += String(d)))
  await once(child, 'exit')
  return out
}

const output = await runHelp()
if (!output.includes('message-drop')) throw new Error('cli help missing project name')
if (!output.includes('start')) throw new Error('cli help missing start command')
if (!output.includes('autostart')) throw new Error('cli help missing autostart command')
if (!output.includes('doctor')) throw new Error('cli help missing doctor command')
```

- [ ] **Step 2: Run verification to confirm it fails before implementation**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: FAIL because CLI package/entrypoint does not exist yet.

- [ ] **Step 3: Implement minimal workspace + CLI command router**

```ts
// packages/cli/src/index.ts
import { runStartCommand } from './commands/start.js'
import { runAutostartCommand } from './commands/autostart.js'
import { runDoctorCommand } from './commands/doctor.js'

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv
  if (!command || command === '--help' || command === '-h') {
    console.log('message-drop <start|autostart|doctor>')
    return
  }
  if (command === 'start') return runStartCommand(rest)
  if (command === 'autostart') return runAutostartCommand(rest)
  if (command === 'doctor') return runDoctorCommand(rest)
  throw new Error(`unknown command: ${command}`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

```json
// packages/cli/package.json
{
  "name": "message-drop",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "bin": {
    "message-drop": "dist/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

```json
// packages/cli/tsconfig.json (key output requirement)
{
  "compilerOptions": {
    "outDir": "dist"
  }
}
```

- [ ] **Step 4: Re-run verification for passing baseline**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: PASS with help output containing required commands.

Run: `pnpm --dir packages/cli run build`  
Expected: PASS with generated `packages/cli/dist/index.js`.

- [ ] **Step 5: Commit**

Run:
`git add pnpm-workspace.yaml package.json packages/cli scripts/verify-phase7-cli.ts`
`git commit -m "feat: add cli workspace and command skeleton"`

## Task 2: Shared Server Bootstrap + `message-drop start`

**Files:**
- Create: `src/start-server.ts`
- Modify: `src/server.ts`
- Modify: `packages/cli/src/commands/start.ts`
- Test: `scripts/verify-phase7-cli.ts`

- [ ] **Step 1: Extend failing verification to assert CLI start can boot server**

```ts
// append to scripts/verify-phase7-cli.ts
import { setTimeout as wait } from 'node:timers/promises'

// Spawn CLI start on random port and assert /debug endpoint responds.
// Assert flags: --host, --port, --data-dir, --open.
// Assert env parity fallback: HOST, PORT, MESSAGE_DROP_DATA_PATH, MESSAGE_DROP_FILES_DIR.
```

- [ ] **Step 2: Run verification to confirm start path fails**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: FAIL because CLI start does not yet launch reusable server API.

- [ ] **Step 3: Implement shared bootstrap and wire start command**

```ts
// src/start-server.ts
export type StartServerOptions = { host: string; port: number; dataPath?: string; filesPath?: string }
export type StartedServer = { stop: () => Promise<void>; url: string }

export async function startMessageDropServer(options: StartServerOptions): Promise<StartedServer> {
  // Create app/store/fileStore, attach ws, return stop() and URL.
}
```

```ts
// packages/cli/src/commands/start.ts
import { startMessageDropServer } from '../../../../src/start-server.js'
export async function runStartCommand(args: string[]): Promise<void> {
  // Parse flags, start server, print URL, keep process alive.
}
```

- [ ] **Step 4: Run verification and existing regression checks**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: PASS, including successful `/debug` check.

Run: `pnpm run verify:phase5`  
Expected: PASS, no websocket/discovery regressions.

- [ ] **Step 5: Commit**

Run:
`git add src/start-server.ts src/server.ts packages/cli/src/commands/start.ts scripts/verify-phase7-cli.ts`
`git commit -m "feat: expose reusable server bootstrap for cli start"`

## Task 3: Autostart Provider System (Windows/Linux/Unsupported)

**Files:**
- Create: `packages/cli/src/autostart/types.ts`
- Create: `packages/cli/src/autostart/provider-factory.ts`
- Create: `packages/cli/src/autostart/providers/linux-systemd.ts`
- Create: `packages/cli/src/autostart/providers/windows-startup.ts`
- Create: `packages/cli/src/autostart/providers/unsupported.ts`
- Modify: `packages/cli/src/commands/autostart.ts`
- Test: `scripts/verify-phase7-cli.ts`

- [ ] **Step 1: Add failing tests for autostart status and unsupported behavior**

```ts
// verify script expectations:
// - "autostart status" prints ENABLED/DISABLED on linux/win mocks
// - unsupported platforms return non-zero and include fixed message.
// - linux with missing user-systemd returns non-zero and actionable guidance.
// Use temp HOME/XDG dirs and fake systemctl binary in PATH for deterministic CI.
```

- [ ] **Step 2: Run tests to capture failing state**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: FAIL due missing provider implementation.

- [ ] **Step 3: Implement provider abstraction and command wiring**

```ts
// types.ts
export type AutostartState = 'enabled' | 'disabled' | 'unsupported'
export interface AutostartProvider {
  enable(): Promise<{ changed: boolean; detail: string }>
  disable(): Promise<{ changed: boolean; detail: string }>
  status(): Promise<{ state: AutostartState; detail: string }>
}
```

```ts
// provider-factory.ts
export function createAutostartProvider(platform: NodeJS.Platform): AutostartProvider {
  if (platform === 'linux') return createLinuxSystemdProvider()
  if (platform === 'win32') return createWindowsStartupProvider()
  return createUnsupportedProvider(platform)
}
```

- [ ] **Step 4: Re-run tests and existing script suite**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: PASS for normal + unsupported command paths.

Run: `pnpm run verify:all`  
Expected: PASS for existing phases.

- [ ] **Step 5: Commit**

Run:
`git add packages/cli/src/autostart packages/cli/src/commands/autostart.ts scripts/verify-phase7-cli.ts`
`git commit -m "feat: add windows linux autostart providers with unsupported fallback"`

## Task 4: Doctor Command (Minimal V1 Install Diagnostics)

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts`
- Create: `packages/cli/src/utils/paths.ts`
- Test: `scripts/verify-phase7-cli.ts`

- [ ] **Step 1: Add failing checks for doctor output contract**

```ts
// verify doctor output includes:
// - node version check
// - data directory writability check
// - port check guidance
```

- [ ] **Step 2: Run verification to confirm failure**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: FAIL due missing required doctor sections.

- [ ] **Step 3: Implement minimal doctor command**

```ts
// doctor.ts
export async function runDoctorCommand(): Promise<void> {
  // Print deterministic checks and summary.
  // Exit 1 on critical failure, otherwise 0.
}
```

- [ ] **Step 4: Run verification**

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: PASS with stable doctor output lines.

- [ ] **Step 5: Commit**

Run:
`git add packages/cli/src/commands/doctor.ts packages/cli/src/utils/paths.ts scripts/verify-phase7-cli.ts`
`git commit -m "feat: add minimal doctor diagnostics for cli install flow"`

## Task 5: Release Check in Web Layer + Android Version Bridge

**Files:**
- Create: `web/src/release.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/types.ts`
- Modify: `android/app/build.gradle.kts`
- Modify: `android/app/src/main/java/com/messagedrop/android/MainActivity.kt`
- Test: `scripts/verify-phase8-release-check.ts`

- [ ] **Step 1: Write failing release-check verification script**

```ts
// scripts/verify-phase8-release-check.ts
// Cases: newer release -> banner state true
// same version -> no banner
// bad payload/network error -> graceful fallback
// cache hit within TTL -> no refetch
// cache expired -> refetch
// transient failure -> bounded retry/backoff then safe fallback
```

- [ ] **Step 2: Run script to ensure it fails**

Run: `pnpm exec tsx scripts/verify-phase8-release-check.ts`  
Expected: FAIL because release-check utilities do not exist.

- [ ] **Step 3: Implement release utility + UI integration**

```ts
// web/src/release.ts
export function parseVersionTag(tag: string): string | null {}
export function compareSemver(a: string, b: string): number {}
export async function fetchLatestReleaseVersion(ownerRepo: string): Promise<{ version: string; url: string } | null> {}
```

```tsx
// web/src/App.tsx
// On mount, trigger async release check.
// Render update banner only when remote version > current app version.
```

- [ ] **Step 4: Re-run checks**

Run: `pnpm exec tsx scripts/verify-phase8-release-check.ts`  
Expected: PASS for new/same/error scenarios.

Run: `pnpm --dir web run build`  
Expected: PASS, no TypeScript/build regressions.

- [ ] **Step 5: Commit**

Run:
`git add web/src/release.ts web/src/api.ts web/src/App.tsx web/src/types.ts android/app/build.gradle.kts android/app/src/main/java/com/messagedrop/android/MainActivity.kt scripts/verify-phase8-release-check.ts`
`git commit -m "feat: add web-owned github release update prompt for android webview"`

## Task 6: Mobile UI Baseline Polish

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.css`
- Test: `scripts/verify-phase4.ts` (regression), `pnpm --dir web run build`

- [ ] **Step 1: Add failing UI assertions where practical**

```ts
// If direct DOM test infra is unavailable, add static checks in verify script:
// assert critical class names/tokens exist in App.css.
```

- [ ] **Step 2: Run checks and confirm baseline gaps**

Run: `pnpm exec tsx scripts/verify-phase4.ts`  
Expected: Existing pass baseline (for no protocol break), while new UI assertions initially fail.

- [ ] **Step 3: Implement style-token and layout improvements**

```css
/* App.css */
:root { --MD_SPACING_SM: 8px; --MD_RADIUS_MD: 10px; /* ... */ }
/* Improve hierarchy and touch targets while preserving behavior */
```

- [ ] **Step 4: Verify no functional regressions**

Run: `pnpm --dir web run build`  
Expected: PASS.

Run: `pnpm run verify:all`  
Expected: PASS (existing messaging/discovery flows unchanged).

- [ ] **Step 5: Commit**

Run:
`git add web/src/App.tsx web/src/App.css scripts/verify-phase4.ts`
`git commit -m "feat: polish mobile webview ui baseline without protocol changes"`

## Task 7: Open-source Readiness Docs and Governance

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `packages/cli/README.md`
- Create: `packages/cli/LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `.gitignore`

- [ ] **Step 1: Add failing release-readiness verification script**

```ts
// scripts/verify-phase9-open-source.ts
// Assert required docs/templates exist and contain minimum sections.
```

- [ ] **Step 2: Run check to confirm failure before files are added**

Run: `pnpm exec tsx scripts/verify-phase9-open-source.ts`  
Expected: FAIL due missing docs/governance files.

- [ ] **Step 3: Create docs/templates and hygiene updates**

```md
# README.md
## What is Message Drop
## Quick Start
## Android Release Install and Update
## Troubleshooting
```

- [ ] **Step 4: Re-run release-readiness checks**

Run: `pnpm exec tsx scripts/verify-phase9-open-source.ts`  
Expected: PASS for required docs and ignore rules.

- [ ] **Step 5: Commit**

Run:
`git add README.md LICENSE packages/cli/README.md packages/cli/LICENSE CONTRIBUTING.md SECURITY.md .github .gitignore scripts/verify-phase9-open-source.ts`
`git commit -m "docs: prepare public github repository governance and readme"`

## Task 8: Release Workflow and Final Verification

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `scripts/verify-phase6.sh` (required: remove absolute path dependency)
- Test: `scripts/verify-phase10-release-workflow.ts`

- [ ] **Step 1: Add failing workflow validation**

```ts
// scripts/verify-phase10-release-workflow.ts
// Check release workflow contains:
// web build, backend verify, apk assemble, npm package build/publish step placeholders.
// Check ci workflow runs on push/pull_request.
// Check package.json has verify:phase7, verify:phase8, verify:phase9, verify:phase10 chained in verify:all.
// Check verify-phase6.sh resolves repo path relative to script directory.
```

- [ ] **Step 2: Run validation to capture missing workflow**

Run: `pnpm exec tsx scripts/verify-phase10-release-workflow.ts`  
Expected: FAIL until workflow is added.

- [ ] **Step 3: Implement release workflow**

```yaml
# .github/workflows/release.yml
# Trigger on tags
# Jobs: verify_all -> build_web -> build_apk -> package_cli -> release_artifacts
#
# .github/workflows/ci.yml
# Trigger on push + pull_request
# Jobs: typecheck + verify:all + web build + apk assemble debug
```

- [ ] **Step 4: Execute full verification matrix**

Run: `pnpm run verify:all`  
Expected: PASS.

Run: `pnpm exec tsx scripts/verify-phase7-cli.ts`  
Expected: PASS.

Run: `pnpm exec tsx scripts/verify-phase8-release-check.ts`  
Expected: PASS.

Run: `pnpm exec tsx scripts/verify-phase9-open-source.ts`  
Expected: PASS.

Run: `pnpm exec tsx scripts/verify-phase10-release-workflow.ts`  
Expected: PASS.

Run: `pnpm --dir packages/cli run build`  
Expected: PASS with `dist/index.js` matching `bin.message-drop`.

- [ ] **Step 5: Commit**

Run:
`git add .github/workflows/release.yml .github/workflows/ci.yml package.json scripts`
`git commit -m "ci: add v1 release workflow and final verification coverage"`

## Final Validation Checklist

- [ ] CLI package builds and local global install path is documented.
- [ ] `autostart` deterministic behavior verified for linux/win + unsupported platforms.
- [ ] Web-owned Android update prompt verified with mocked release responses.
- [ ] Mobile UI polish verified by build + regression scripts.
- [ ] Public repo docs/templates present and coherent.
- [ ] Full verify suite passes without ADB dependency.
- [ ] `pnpm --dir packages/cli publish --dry-run` (or `npm pack`) confirms package contents and `message-drop` bin mapping.
- [ ] Global install smoke path verified (`pnpm add -g message-drop` or local tarball install + `message-drop --help`).
