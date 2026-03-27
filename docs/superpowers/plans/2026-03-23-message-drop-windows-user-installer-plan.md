# Message Drop Windows User Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows user-level installer baseline that runs Message Drop as a tray-oriented background app with private runtime assumptions and no system Node.js conflicts.

**Architecture:** Introduce a new `packages/windows-agent` package (Electron main-process app) responsible for tray UI, server lifecycle, and user-level autostart. Keep existing server logic as the backend runtime, and add packaging scripts plus verification scripts for contract checks. Preserve existing CLI workflow as a fallback.

**Tech Stack:** Electron (tray process), TypeScript/Node scripts, pnpm workspace, existing message-drop server modules.

---

## File Structure and Responsibilities

- Create `packages/windows-agent/package.json` for Windows tray app dependencies, tests, and packaging scripts.
- Create `packages/windows-agent/main.cjs` for Electron tray entry and lifecycle wiring.
- Create `packages/windows-agent/lib/supervisor.mjs` for server process start/stop/retry/cooldown logic.
- Create `packages/windows-agent/lib/autostart.mjs` for user-level startup registration toggles.
- Create `packages/windows-agent/lib/menu-state.mjs` for deterministic tray menu template mapping by state.
- Create `packages/windows-agent/lib/paths.mjs` for app-owned runtime/config/data/log path resolution.
- Create tests:
  - `packages/windows-agent/test/menu-state.test.mjs`
  - `packages/windows-agent/test/autostart.test.mjs`
  - `packages/windows-agent/test/supervisor.test.mjs`
  - `packages/windows-agent/test/integration-lifecycle.test.mjs`
- Create `scripts/verify-phase11-windows-installer.ts` for repo-level wiring/docs/build checks.
- Modify `pnpm-workspace.yaml` to include `packages/windows-agent`.
- Modify root `package.json` to add phase11 verify/build script and chain it into `verify:all`.
- Modify `README.md` with install, upgrade, uninstall, and troubleshooting guidance for Windows tray mode.

### Task 1: Scaffold windows-agent package and deterministic state modules

**Files:**
- Create: `packages/windows-agent/package.json`
- Create: `packages/windows-agent/lib/menu-state.mjs`
- Create: `packages/windows-agent/lib/paths.mjs`
- Create: `packages/windows-agent/test/menu-state.test.mjs`
- Modify: `pnpm-workspace.yaml`
- Test: `packages/windows-agent/test/menu-state.test.mjs`

- [ ] **Step 1: Write failing menu-state test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMenuTemplate } from '../lib/menu-state.mjs'

test('error state shows Retry Start and View Logs', () => {
  const template = buildMenuTemplate({ status: 'error', autostartEnabled: true })
  assert.ok(template.some((x) => x.label === 'Retry Start'))
  assert.ok(template.some((x) => x.label === 'View Logs'))
})
```

- [ ] **Step 2: Run test and confirm fail**

Run: `pnpm --dir packages/windows-agent test -- test/menu-state.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement minimal state modules**

```js
// menu-state.mjs exports buildMenuTemplate(state)
// paths.mjs exports resolveWindowsAgentPaths(baseEnv?)
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm --dir packages/windows-agent test -- test/menu-state.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml packages/windows-agent
git commit -m "feat: scaffold windows agent state modules"
```

### Task 2: Implement supervisor and lifecycle tests (start/stop/readiness/cooldown)

**Files:**
- Create: `packages/windows-agent/lib/supervisor.mjs`
- Create: `packages/windows-agent/test/supervisor.test.mjs`
- Create: `packages/windows-agent/test/integration-lifecycle.test.mjs`
- Test: `packages/windows-agent/test/supervisor.test.mjs`
- Test: `packages/windows-agent/test/integration-lifecycle.test.mjs`

- [ ] **Step 1: Write failing supervisor tests**

```js
test('stop performs graceful then force kill on timeout', async () => { /* ... */ })
test('restart cooldown enforces bounded retries', async () => { /* ... */ })
test('port conflict is mapped to explicit tray hint', async () => { /* ... */ })
```

- [ ] **Step 2: Run tests and confirm fail**

Run: `pnpm --dir packages/windows-agent test -- test/supervisor.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement minimal supervisor**

```js
// createSupervisor({ spawnServer, healthProbe, retryLimit, cooldownMs })
// methods: start(), stop(), retry(), status()
```

- [ ] **Step 4: Add integration lifecycle test with fake spawn + probe**

Run: `pnpm --dir packages/windows-agent test -- test/integration-lifecycle.test.mjs`
Expected: PASS when lifecycle semantics are correct.

- [ ] **Step 5: Commit**

```bash
git add packages/windows-agent/lib/supervisor.mjs packages/windows-agent/test
git commit -m "feat: add windows agent supervisor lifecycle"
```

### Task 3: Implement user-level autostart module and tray entry wiring

**Files:**
- Create: `packages/windows-agent/lib/autostart.mjs`
- Create: `packages/windows-agent/main.cjs`
- Create: `packages/windows-agent/test/autostart.test.mjs`
- Modify: `packages/windows-agent/package.json`
- Test: `packages/windows-agent/test/autostart.test.mjs`

- [ ] **Step 1: Write failing autostart tests**

```js
test('enable writes user-scope startup artifact', async () => { /* ... */ })
test('disable removes startup artifact', async () => { /* ... */ })
test('status reports enabled/disabled deterministically', async () => { /* ... */ })
```

- [ ] **Step 2: Run test and confirm fail**

Run: `pnpm --dir packages/windows-agent test -- test/autostart.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement autostart + tray wiring**

```js
// main.cjs:
// - app.whenReady => create Tray
// - menu from buildMenuTemplate()
// - entries: Open Message Drop, Start/Stop Server, Open Data Folder,
//            Autostart: On/Off, Quit
// - error state adds Retry Start + View Logs
```

- [ ] **Step 4: Run focused tests**

Run:
- `pnpm --dir packages/windows-agent test -- test/autostart.test.mjs`
- `pnpm --dir packages/windows-agent test -- test/menu-state.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/windows-agent/main.cjs packages/windows-agent/lib/autostart.mjs packages/windows-agent/test/autostart.test.mjs
git commit -m "feat: wire tray app and user-level autostart"
```

### Task 4: Add packaging scripts, phase11 verifier, and root wiring

**Files:**
- Create: `scripts/verify-phase11-windows-installer.ts`
- Modify: `packages/windows-agent/package.json`
- Modify: `package.json`
- Test: `scripts/verify-phase11-windows-installer.ts`

- [ ] **Step 1: Write failing phase11 verifier**

```ts
// Checks:
// - windows-agent workspace exists
// - root verify/build scripts exist
// - tray contract markers exist
// - README windows section markers exist
// - runtime isolation checks include absolute app-owned launch path marker
// - install default includes autostart enabled behavior in docs/contracts
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm exec tsx scripts/verify-phase11-windows-installer.ts`
Expected: FAIL.

- [ ] **Step 3: Implement package + root script wiring**

```json
// package.json root
"verify:phase11-windows-installer": "tsx scripts/verify-phase11-windows-installer.ts",
"build:windows-agent": "pnpm --dir packages/windows-agent run dist:win"
```

and include phase11 in `verify:all`.

- [ ] **Step 4: Run and confirm pass**

Run: `pnpm exec tsx scripts/verify-phase11-windows-installer.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-phase11-windows-installer.ts package.json packages/windows-agent/package.json
git commit -m "build: add windows agent packaging and phase11 verification"
```

### Task 5: Update README for install, upgrade, uninstall, troubleshooting

**Files:**
- Modify: `README.md`
- Modify: `scripts/verify-phase11-windows-installer.ts`
- Test: `scripts/verify-phase11-windows-installer.ts`

- [ ] **Step 1: Add failing README assertions**

```ts
assertContains(readme, '## Windows user installer (tray mode)')
assertContains(readme, 'Upgrade')
assertContains(readme, 'Uninstall')
assertContains(readme, 'private runtime')
assertContains(readme, 'does not modify your global Node.js')
assertContains(readme, 'autostart is enabled by default at install time')
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm exec tsx scripts/verify-phase11-windows-installer.ts`
Expected: FAIL.

- [ ] **Step 3: Update README**

Include:
- install steps
- login silent autostart behavior
- default install contract: autostart enabled at install time
- upgrade path (install newer package over existing)
- uninstall behavior (startup artifact removed; data handling note)
- troubleshooting (port conflict, startup disabled, manual CLI fallback)

- [ ] **Step 4: Run full validations**

Run:
- `pnpm --dir packages/windows-agent test`
- `pnpm run typecheck`
- `pnpm run verify:phase11-windows-installer`
- `pnpm run verify:all`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/verify-phase11-windows-installer.ts
git commit -m "docs: add windows user installer operating guide"
```

## Final Validation

- [ ] `pnpm --dir packages/windows-agent test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run verify:phase11-windows-installer`
- [ ] `pnpm run verify:all`
- [ ] On Windows VM or runner: `pnpm run build:windows-agent` and verify installer artifact path exists.
- [ ] On Windows VM: uninstall global Node.js (or use clean VM), install app, confirm tray mode still starts and serves UI.
- [ ] On Windows VM: verify autostart is enabled immediately after install and launches silently after re-login.
- [ ] On Windows VM: simulate port conflict and confirm tray shows explicit conflict hint with recovery action.
