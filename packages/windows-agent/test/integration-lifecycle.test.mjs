import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { createSupervisor } from '../lib/supervisor.mjs'

function createLifecycleChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.kills = []
  child.kill = (signal = 'SIGTERM') => {
    child.kills.push(signal)
    if (signal === 'SIGTERM') {
      queueMicrotask(() => {
        child.emit('exit', 0, signal)
      })
    }
    return true
  }
  return child
}

test('start integrates fake spawn and readiness probe', async () => {
  let probeCalls = 0
  const child = createLifecycleChild(9001)
  const supervisor = createSupervisor({
    spawnServer: () => child,
    healthProbe: async () => {
      probeCalls += 1
      return probeCalls >= 3
    },
    readinessIntervalMs: 10,
    readinessTimeoutMs: 100,
    sleep: async () => {}
  })

  const current = await supervisor.start()

  assert.equal(current.running, true)
  assert.equal(current.pid, 9001)
  assert.equal(probeCalls, 3)
})

test('lifecycle supports start retry stop with fake process handles', async () => {
  let nextPid = 3000
  let nowMs = 0
  const children = []
  const supervisor = createSupervisor({
    spawnServer: () => {
      nextPid += 1
      const child = createLifecycleChild(nextPid)
      children.push(child)
      return child
    },
    healthProbe: async () => true,
    retryLimit: 2,
    cooldownMs: 50,
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += ms
    }
  })

  await supervisor.start()
  await supervisor.stop()
  nowMs = 10
  const retryResult = await supervisor.retry()
  await supervisor.stop()

  assert.equal(retryResult.ok, true)
  assert.equal(children.length, 2)
  assert.deepEqual(children[0].kills, ['SIGTERM'])
  assert.deepEqual(children[1].kills, ['SIGTERM'])
  assert.equal(supervisor.status().running, false)
})
