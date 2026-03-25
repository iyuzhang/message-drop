import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  disableAutostart,
  enableAutostart,
  getAutostartStatus
} from '../lib/autostart.mjs'

function createTestPaths(rootDir) {
  return {
    autostartMarkerFile: path.join(rootDir, 'config', 'autostart-enabled.json'),
    startupScriptFile: path.join(rootDir, 'startup', 'message-drop-agent.cmd')
  }
}

test('enableAutostart_createsMarkerAndScriptAndSetsEnabled', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'windows-agent-autostart-'))
  const testPaths = createTestPaths(rootDir)

  try {
    const result = await enableAutostart(testPaths)
    assert.equal(result.enabled, true)
    assert.equal(result.markerExists, true)
    assert.equal(result.scriptExists, true)

    const status = await getAutostartStatus(testPaths)
    assert.equal(status.enabled, true)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('disableAutostart_removesMarkerAndScriptAndSetsDisabled', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'windows-agent-autostart-'))
  const testPaths = createTestPaths(rootDir)

  try {
    await enableAutostart(testPaths)
    const disabled = await disableAutostart(testPaths)
    assert.equal(disabled.enabled, false)

    const status = await getAutostartStatus(testPaths)
    assert.equal(status.enabled, false)
    assert.equal(status.markerExists, false)
    assert.equal(status.scriptExists, false)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('getAutostartStatus_reportsDisabledWhenNoArtifactsExist', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'windows-agent-autostart-'))
  const testPaths = createTestPaths(rootDir)

  try {
    const status = await getAutostartStatus(testPaths)
    assert.equal(status.enabled, false)
    assert.equal(status.markerExists, false)
    assert.equal(status.scriptExists, false)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('enableAutostart_writesAbsoluteStartupLaunchAndNoPathLookupCommand', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'windows-agent-autostart-'))
  const testPaths = createTestPaths(rootDir)

  try {
    await enableAutostart(testPaths)
    const script = await readFile(testPaths.startupScriptFile, 'utf8')
    assert.ok(script.includes(`"${process.execPath}"`))
    assert.ok(path.isAbsolute(process.execPath))
    assert.ok(!script.includes('"message-drop"'))
    assert.ok(!script.includes('"pnpm"'))
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
