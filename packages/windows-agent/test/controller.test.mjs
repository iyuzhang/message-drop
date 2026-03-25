import assert from 'node:assert/strict'
import test from 'node:test'

import { createAgentController } from '../lib/controller.mjs'

test('retryService_handlesFailureAndAlwaysRefreshes', async () => {
  let refreshCalls = 0
  const controller = createAgentController({
    supervisor: {
      retry: async () => {
        throw new Error('retry failed')
      },
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled: false })
    },
    refresh: async () => {
      refreshCalls += 1
    }
  })

  const result = await controller.retryService()
  assert.equal(result.ok, false)
  assert.equal(controller.state.status, 'error')
  assert.equal(refreshCalls, 1)
})

test('toggleAutostart_switchesBetweenEnableAndDisable', async () => {
  let enabled = false
  const calls = []
  const controller = createAgentController({
    supervisor: {
      retry: async () => ({ ok: true }),
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled }),
      enableAutostart: async () => {
        enabled = true
        calls.push('enable')
      },
      disableAutostart: async () => {
        enabled = false
        calls.push('disable')
      }
    },
    refresh: async () => {}
  })

  await controller.toggleAutostart()
  await controller.toggleAutostart()

  assert.deepEqual(calls, ['enable', 'disable'])
  assert.equal(controller.state.autostartEnabled, false)
})

test('startService_setsRunningOnSuccess', async () => {
  let refreshCalls = 0
  const controller = createAgentController({
    supervisor: {
      start: async () => {},
      retry: async () => ({ ok: true }),
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled: false })
    },
    refresh: async () => {
      refreshCalls += 1
    }
  })

  assert.equal(controller.state.status, 'stopped')
  const result = await controller.startService()
  assert.equal(result.ok, true)
  assert.equal(controller.state.status, 'running')
  assert.equal(refreshCalls, 1)
})

test('stopService_setsStoppedOnSuccessAndRefreshes', async () => {
  let refreshCalls = 0
  const controller = createAgentController({
    supervisor: {
      start: async () => {},
      retry: async () => ({ ok: true }),
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled: false })
    },
    refresh: async () => {
      refreshCalls += 1
    }
  })

  await controller.startService()
  const result = await controller.stopService()
  assert.equal(result.ok, true)
  assert.equal(controller.state.status, 'stopped')
  assert.equal(refreshCalls, 2)
})

test('retryService_handlesNonThrowFailurePathAndRefreshes', async () => {
  let refreshCalls = 0
  const controller = createAgentController({
    supervisor: {
      start: async () => {},
      retry: async () => ({ ok: false, reason: 'retry_limit_exceeded' }),
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled: false })
    },
    refresh: async () => {
      refreshCalls += 1
    }
  })

  const result = await controller.retryService()
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'retry_limit_exceeded')
  assert.equal(controller.state.status, 'error')
  assert.equal(refreshCalls, 1)
})

test('startOnLaunch_initializesThenStartsAndRefreshesTwiceOnSuccess', async () => {
  let refreshCalls = 0
  const controller = createAgentController({
    supervisor: {
      start: async () => {},
      retry: async () => ({ ok: true }),
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled: true })
    },
    refresh: async () => {
      refreshCalls += 1
    }
  })

  const result = await controller.startOnLaunch()
  assert.equal(result.ok, true)
  assert.equal(controller.state.autostartEnabled, true)
  assert.equal(controller.state.status, 'running')
  assert.equal(refreshCalls, 2)
})

test('startOnLaunch_setsErrorSafelyWhenStartFails', async () => {
  let refreshCalls = 0
  const controller = createAgentController({
    supervisor: {
      start: async () => {
        throw new Error('boot fail')
      },
      retry: async () => ({ ok: true }),
      stop: async () => {}
    },
    autostart: {
      getAutostartStatus: async () => ({ enabled: false })
    },
    refresh: async () => {
      refreshCalls += 1
    }
  })

  const result = await controller.startOnLaunch()
  assert.equal(result.ok, false)
  assert.equal(controller.state.status, 'error')
  assert.equal(refreshCalls, 2)
})
