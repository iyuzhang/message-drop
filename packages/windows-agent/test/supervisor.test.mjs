import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { createSupervisor } from '../lib/supervisor.mjs'

function createFakeChild({ pid = 1234, exitsOnSignal = null } = {}) {
  const child = new EventEmitter()
  child.pid = pid
  child.kills = []
  child.kill = (signal = 'SIGTERM') => {
    child.kills.push(signal)
    if (exitsOnSignal && exitsOnSignal === signal) {
      queueMicrotask(() => {
        child.emit('exit', 0, signal)
      })
    }
    return true
  }
  return child
}

test('stop performs graceful then force kill on timeout', async () => {
  const child = createFakeChild()
  const supervisor = createSupervisor({
    spawnServer: () => child,
    healthProbe: async () => true,
    stopTimeoutMs: 0,
    forceKillTimeoutMs: 0,
    sleep: async () => {}
  })

  await supervisor.start()
  const stopResultPromise = supervisor.stop()
  queueMicrotask(() => {
    child.emit('exit', null, 'SIGKILL')
  })
  await stopResultPromise

  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
})

test('retry enforces cooldown and retry limit', async () => {
  let nowMs = 1000
  const attempts = []
  const child = createFakeChild({ pid: 7001, exitsOnSignal: 'SIGTERM' })
  const supervisor = createSupervisor({
    spawnServer: () => {
      attempts.push(nowMs)
      return child
    },
    healthProbe: async () => true,
    retryLimit: 2,
    cooldownMs: 200,
    stopTimeoutMs: 0,
    forceKillTimeoutMs: 0,
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms
    }
  })

  await supervisor.retry()
  await supervisor.stop()
  nowMs += 10
  await supervisor.retry()
  await supervisor.stop()
  nowMs += 10
  const result = await supervisor.retry()

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'retry_limit_exceeded')
  assert.deepEqual(attempts, [1000, 1200])
})

test('port conflict is classified explicitly for tray hint handling', async () => {
  const supervisor = createSupervisor({
    spawnServer: () => {
      const error = new Error('listen EADDRINUSE: address already in use :::53317')
      error.code = 'EADDRINUSE'
      throw error
    },
    healthProbe: async () => true
  })

  await assert.rejects(() => supervisor.start())
  const current = supervisor.status()
  assert.equal(current.lastError?.classification, 'port_conflict')
  assert.equal(current.lastError?.hint, 'port_in_use')
})

test('readiness timeout preserves explicit classification and hint', async () => {
  const child = createFakeChild({ pid: 8123, exitsOnSignal: 'SIGTERM' })
  const supervisor = createSupervisor({
    spawnServer: () => child,
    healthProbe: async () => false,
    readinessTimeoutMs: 0,
    readinessIntervalMs: 1,
    stopTimeoutMs: 0,
    forceKillTimeoutMs: 0,
    sleep: async () => {}
  })

  await assert.rejects(() => supervisor.start())
  const current = supervisor.status()
  assert.equal(current.lastError?.classification, 'readiness_timeout')
  assert.equal(current.lastError?.hint, 'check_logs')
})

test('invalid readiness interval fails deterministically', () => {
  assert.throws(
    () =>
      createSupervisor({
        spawnServer: () => createFakeChild(),
        healthProbe: async () => true,
        readinessIntervalMs: 0
      }),
    /readinessIntervalMs must be a positive number\./
  )
})
