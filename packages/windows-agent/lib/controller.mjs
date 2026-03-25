export function createAgentController({ supervisor, autostart, refresh }) {
  const state = {
    status: 'stopped',
    autostartEnabled: false
  }

  async function initialize() {
    const current = await autostart.getAutostartStatus()
    state.autostartEnabled = current.enabled
    await refresh()
    return { ok: true }
  }

  async function startService() {
    try {
      await supervisor.start()
      state.status = 'running'
      return { ok: true }
    } catch (error) {
      state.status = 'error'
      return { ok: false, error }
    } finally {
      await refresh()
    }
  }

  async function stopService() {
    try {
      await supervisor.stop()
      state.status = 'stopped'
      return { ok: true }
    } catch (error) {
      state.status = 'error'
      return { ok: false, error }
    } finally {
      await refresh()
    }
  }

  async function retryService() {
    try {
      const result = await supervisor.retry()
      state.status = result.ok ? 'running' : 'error'
      return result
    } catch (error) {
      state.status = 'error'
      return { ok: false, reason: 'retry_failed', error }
    } finally {
      await refresh()
    }
  }

  async function toggleAutostart() {
    const current = await autostart.getAutostartStatus()
    if (current.enabled) {
      await autostart.disableAutostart()
    } else {
      await autostart.enableAutostart()
    }
    const updated = await autostart.getAutostartStatus()
    state.autostartEnabled = updated.enabled
    await refresh()
    return { ok: true, enabled: updated.enabled }
  }

  async function startOnLaunch() {
    await initialize()
    return startService()
  }

  return {
    state,
    initialize,
    startOnLaunch,
    startService,
    stopService,
    retryService,
    toggleAutostart
  }
}
