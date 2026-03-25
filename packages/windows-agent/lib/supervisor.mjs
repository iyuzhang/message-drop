const DEFAULT_RETRY_LIMIT = 3
const DEFAULT_COOLDOWN_MS = 1000
const DEFAULT_READINESS_TIMEOUT_MS = 5000
const DEFAULT_READINESS_INTERVAL_MS = 100
const DEFAULT_STOP_TIMEOUT_MS = 2000
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 1000
const TIMEOUT = Symbol('timeout')

function createReadinessTimeoutError() {
  const error = new Error('Server did not become ready before timeout.')
  error.classification = 'readiness_timeout'
  error.hint = 'check_logs'
  return error
}

function validatePositiveMs(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number.`)
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function classifyError(error) {
  const message = String(error?.message ?? '')
  const isPortConflict =
    error?.code === 'EADDRINUSE' ||
    message.includes('EADDRINUSE') ||
    /address already in use/i.test(message) ||
    /port .* in use/i.test(message)

  if (isPortConflict) {
    return {
      classification: 'port_conflict',
      hint: 'port_in_use',
      message
    }
  }

  return {
    classification: 'generic',
    hint: 'none',
    message
  }
}

async function waitForChildExit(child, timeoutMs, sleep) {
  if (!child || typeof child.once !== 'function') {
    return true
  }

  const exitPromise = new Promise((resolve) => {
    child.once('exit', () => {
      resolve(true)
    })
  })
  const timeoutPromise = (async () => {
    await sleep(timeoutMs)
    return TIMEOUT
  })()
  const result = await Promise.race([exitPromise, timeoutPromise])
  return result !== TIMEOUT
}

async function waitForReadiness({
  healthProbe,
  readinessTimeoutMs,
  readinessIntervalMs,
  sleep
}) {
  let elapsedMs = 0
  while (elapsedMs <= readinessTimeoutMs) {
    const ready = await healthProbe()
    if (ready) {
      return true
    }

    await sleep(readinessIntervalMs)
    elapsedMs += readinessIntervalMs
  }

  return false
}

export function createSupervisor(options) {
  const {
    spawnServer,
    healthProbe,
    retryLimit = DEFAULT_RETRY_LIMIT,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
    readinessIntervalMs = DEFAULT_READINESS_INTERVAL_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
    sleep = defaultSleep,
    now = () => Date.now()
  } = options

  validatePositiveMs(readinessIntervalMs, 'readinessIntervalMs')

  let child = null
  let state = 'stopped'
  let retryCount = 0
  let lastRetryAtMs = null
  let lastError = null

  function status() {
    return {
      state,
      running: state === 'running',
      pid: child?.pid ?? null,
      retryCount,
      retryLimit,
      cooldownMs,
      lastError
    }
  }

  async function start() {
    if (state === 'running') {
      return status()
    }

    state = 'starting'
    lastError = null

    try {
      const nextChild = await spawnServer()
      child = nextChild
      if (child && typeof child.once === 'function') {
        child.once('exit', () => {
          child = null
          state = 'stopped'
        })
      }

      const ready = await waitForReadiness({
        healthProbe,
        readinessTimeoutMs,
        readinessIntervalMs,
        sleep
      })

      if (!ready) {
        const readinessError = createReadinessTimeoutError()
        lastError = {
          classification: readinessError.classification,
          hint: readinessError.hint,
          message: readinessError.message
        }
        await stop()
        throw readinessError
      }

      state = 'running'
      return status()
    } catch (error) {
      state = 'error'
      if (!lastError) {
        lastError = classifyError(error)
      }
      throw error
    }
  }

  async function stop() {
    if (!child) {
      state = 'stopped'
      return { stopped: true, forced: false }
    }

    const targetChild = child
    if (typeof targetChild.kill === 'function') {
      targetChild.kill('SIGTERM')
    }
    const gracefulExit = await waitForChildExit(targetChild, stopTimeoutMs, sleep)
    if (gracefulExit) {
      child = null
      state = 'stopped'
      return { stopped: true, forced: false }
    }

    if (typeof targetChild.kill === 'function') {
      targetChild.kill('SIGKILL')
    }
    await waitForChildExit(targetChild, forceKillTimeoutMs, sleep)
    child = null
    state = 'stopped'
    return { stopped: true, forced: true }
  }

  async function retry() {
    if (retryCount >= retryLimit) {
      return { ok: false, reason: 'retry_limit_exceeded' }
    }

    const nowMs = now()
    if (lastRetryAtMs !== null) {
      const elapsedMs = nowMs - lastRetryAtMs
      if (elapsedMs < cooldownMs) {
        await sleep(cooldownMs - elapsedMs)
      }
    }

    retryCount += 1
    lastRetryAtMs = now()
    if (state === 'running') {
      await stop()
    }

    await start()
    return { ok: true, reason: null }
  }

  return {
    start,
    stop,
    retry,
    status
  }
}
