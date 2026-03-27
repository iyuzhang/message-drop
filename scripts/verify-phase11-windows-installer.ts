/**
 * Verifies Phase 11 Windows installer baseline contracts.
 * README Windows marker checks are enforced by default.
 * Set VERIFY_PHASE11_SKIP_README=1 only for temporary local bypass.
 */
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

function readUtf8(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

function assertFileExists(root: string, rel: string, label: string): void {
  assert.ok(existsSync(join(root, rel)), `${label}: missing ${rel}`)
}

function assertContainsAll(text: string, markers: string[], label: string): void {
  for (const marker of markers) {
    assert.ok(text.includes(marker), `${label}: missing marker "${marker}"`)
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

void (function main(): void {
  const root = repoRoot()
  const skipReadmeChecks = process.env.VERIFY_PHASE11_SKIP_README === '1'

  assertFileExists(root, 'pnpm-workspace.yaml', 'phase11')
  assertFileExists(root, 'package.json', 'phase11')
  assertFileExists(root, 'packages/windows-agent/package.json', 'phase11')
  assertFileExists(root, 'packages/windows-agent/main.cjs', 'phase11')
  assertFileExists(root, 'packages/windows-agent/lib/menu-state.mjs', 'phase11')
  assertFileExists(root, 'packages/windows-agent/lib/autostart.mjs', 'phase11')

  const workspace = readUtf8(root, 'pnpm-workspace.yaml')
  assert.ok(
    workspace.includes("'packages/*'") || workspace.includes('"packages/*"'),
    'pnpm-workspace.yaml must include packages/* for windows-agent workspace resolution',
  )

  const rootPkg = JSON.parse(readUtf8(root, 'package.json')) as {
    scripts?: Record<string, string>
  }
  const windowsPkg = JSON.parse(readUtf8(root, 'packages/windows-agent/package.json')) as {
    scripts?: Record<string, string>
  }

  assert.ok(
    typeof rootPkg.scripts?.['verify:phase11-windows-installer'] === 'string',
    'package.json must define scripts.verify:phase11-windows-installer',
  )
  const verifyPhase11Script = normalizeWhitespace(
    rootPkg.scripts?.['verify:phase11-windows-installer'] ?? '',
  )
  assert.equal(
    verifyPhase11Script,
    'tsx scripts/verify-phase11-windows-installer.ts',
    'scripts.verify:phase11-windows-installer must equal "tsx scripts/verify-phase11-windows-installer.ts" (whitespace-normalized)',
  )
  assert.ok(
    typeof rootPkg.scripts?.['build:windows-agent'] === 'string',
    'package.json must define scripts.build:windows-agent',
  )
  assert.ok(
    rootPkg.scripts?.['build:windows-agent']?.includes('packages/windows-agent'),
    'scripts.build:windows-agent must target packages/windows-agent',
  )
  assert.ok(
    rootPkg.scripts?.['build:windows-agent']?.includes('run dist:win'),
    'scripts.build:windows-agent must explicitly run dist:win',
  )

  const verifyAll = rootPkg.scripts?.['verify:all']
  assert.ok(typeof verifyAll === 'string', 'package.json must define scripts.verify:all')
  assert.ok(
    verifyAll.includes('verify:phase11-windows-installer'),
    'scripts.verify:all must include verify:phase11-windows-installer',
  )

  assert.ok(
    typeof windowsPkg.scripts?.['dist:win'] === 'string',
    'packages/windows-agent/package.json must define scripts.dist:win',
  )
  const distWinScript = normalizeWhitespace(windowsPkg.scripts?.['dist:win'] ?? '')
  assert.ok(
    distWinScript.includes('electron-builder --win'),
    'packages/windows-agent/package.json scripts.dist:win must include "electron-builder --win"',
  )

  const mainCjs = readUtf8(root, 'packages/windows-agent/main.cjs')
  assertContainsAll(
    mainCjs,
    [
      'app.whenReady()',
      'new Tray',
      'Open Message Drop',
      'Open Data Folder',
      'Start Server',
      'Stop Server',
      'Autostart: On',
      'Autostart: Off',
      'Retry Start',
      'View Logs',
      'Quit',
    ],
    'tray contract',
  )

  const menuState = readUtf8(root, 'packages/windows-agent/lib/menu-state.mjs')
  assertContainsAll(
    menuState,
    ['Start Server', 'Stop Server', 'Retry Start', 'View Logs'],
    'menu-state contract',
  )

  const autostart = readUtf8(root, 'packages/windows-agent/lib/autostart.mjs')
  assertContainsAll(
    autostart,
    ['process.execPath', 'agentExecutablePath', 'path.isAbsolute'],
    'autostart runtime isolation contract',
  )
  assert.ok(
    !autostart.includes('"message-drop"') && !autostart.includes('"pnpm"'),
    'autostart must not use PATH-based startup command markers',
  )

  assertContainsAll(
    mainCjs,
    ['process.execPath', 'MESSAGE_DROP_SERVER_EXECUTABLE_PATH', 'path.isAbsolute'],
    'main runtime isolation contract',
  )
  assert.ok(
    !mainCjs.includes("|| 'pnpm'"),
    'main.cjs must not default to PATH-based command names',
  )

  const readme = readUtf8(root, 'README.md').toLowerCase()
  if (!skipReadmeChecks) {
    assertContainsAll(
      readme,
      [
        '## windows user installer (tray mode)',
        'autostart is enabled by default at install time',
        'upgrade path',
        'uninstall behavior',
        'private app-owned runtime paths',
        'no global node.js installation is modified',
        'port conflict',
        'startup disabled',
        'manual cli fallback',
      ],
      'README windows Task 5 markers',
    )
  }

  console.log(
    `[verify-phase11-windows-installer] ok${skipReadmeChecks ? ' (README checks skipped via VERIFY_PHASE11_SKIP_README=1)' : ' (README checks enforced by default)'}`,
  )
})()
