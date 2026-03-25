const STATUS_LABEL_BY_STATE = {
  running: 'Status: Running',
  stopped: 'Status: Stopped',
  error: 'Status: Error'
}

export function buildMenuTemplate(state) {
  const status = state?.status ?? 'stopped'
  const statusLabel = STATUS_LABEL_BY_STATE[status] ?? STATUS_LABEL_BY_STATE.stopped
  const autostartLabel = state?.autostartEnabled ? 'Autostart: On' : 'Autostart: Off'
  const lifecycleActionLabel = status === 'running' ? 'Stop Server' : 'Start Server'
  const template = [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: lifecycleActionLabel },
    { label: autostartLabel },
    { type: 'separator' },
    { label: 'Quit' }
  ]

  if (status === 'error') {
    template.splice(
      4,
      0,
      { label: 'Retry Start' },
      { label: 'View Logs' }
    )
  }

  return template
}
