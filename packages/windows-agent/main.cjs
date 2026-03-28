const { createWriteStream, existsSync, mkdirSync } = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { app, Menu, Tray, nativeImage, shell } = require('electron')

const APP_URL = process.env.MESSAGE_DROP_APP_URL || 'http://127.0.0.1:8787'
const HEALTH_URL = process.env.MESSAGE_DROP_HEALTH_URL || `${APP_URL}/health`
const HEALTH_TIMEOUT_MS = Number(process.env.MESSAGE_DROP_HEALTH_TIMEOUT_MS || 1000)
const MODULE_URL = pathToFileURL(path.join(__dirname, 'lib')).href
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..')

let tray = null
let modules = null
let supervisor = null
let controller = null
let resolvedPaths = null

function toModuleUrl(fileName) {
  return `${MODULE_URL}/${fileName}`
}

function parseArgs(value) {
  if (!value) {
    return []
  }
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ''))
}

function createHealthProbe(url, timeoutMs) {
  return async () => {
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, timeoutMs)
    try {
      const response = await fetch(url, { signal: abortController.signal })
      if (!response.ok) {
        return false
      }
      const payload = await response.json().catch(() => null)
      return payload?.ok === true
    } catch {
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

function resolveServerRuntime() {
  const executablePath = process.env.MESSAGE_DROP_SERVER_EXECUTABLE_PATH || process.execPath
  const explicitScriptPath = process.env.MESSAGE_DROP_SERVER_SCRIPT_PATH
  const packagedScriptPath = process.resourcesPath
    ? path.join(process.resourcesPath, 'server', 'server.cjs')
    : null

  let serverScriptPath = null
  if (explicitScriptPath) {
    serverScriptPath = path.isAbsolute(explicitScriptPath)
      ? explicitScriptPath
      : path.resolve(explicitScriptPath)
  } else if (packagedScriptPath && existsSync(packagedScriptPath)) {
    serverScriptPath = packagedScriptPath
  } else if (app.isPackaged) {
    throw new Error(
      'Packaged server runtime missing. Expected MESSAGE_DROP_SERVER_SCRIPT_PATH or resources/server/server.cjs.'
    )
  } else {
    serverScriptPath = path.join(WORKSPACE_ROOT, 'src', 'server.ts')
  }

  return {
    executablePath,
    serverScriptPath
  }
}

function buildServerArgs(serverScriptPath) {
  const explicitArgs = parseArgs(process.env.MESSAGE_DROP_SERVER_ARGS)
  if (explicitArgs.length > 0) {
    return explicitArgs
  }
  if (serverScriptPath.endsWith('.ts')) {
    return ['--import', 'tsx', serverScriptPath]
  }
  return [serverScriptPath]
}

function createSpawnServer(logFilePath, runtimeRoot) {
  const { executablePath, serverScriptPath } = resolveServerRuntime()
  const args = buildServerArgs(serverScriptPath)
  const defaultCwd = app.isPackaged ? process.resourcesPath : WORKSPACE_ROOT
  const cwd = process.env.MESSAGE_DROP_SERVER_CWD || defaultCwd
  const dataPath = path.join(runtimeRoot, 'messages.json')
  const filesDir = path.join(runtimeRoot, 'files')

  return () => {
    if (!path.isAbsolute(executablePath)) {
      throw new Error('MESSAGE_DROP_SERVER_EXECUTABLE_PATH must be absolute.')
    }
    if (!path.isAbsolute(serverScriptPath)) {
      throw new Error('MESSAGE_DROP_SERVER_SCRIPT_PATH must resolve to an absolute path.')
    }
    mkdirSync(path.dirname(logFilePath), { recursive: true })
    const output = createWriteStream(logFilePath, { flags: 'a' })
    const child = spawn(executablePath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MESSAGE_DROP_DATA_PATH: process.env.MESSAGE_DROP_DATA_PATH || dataPath,
        MESSAGE_DROP_FILES_DIR: process.env.MESSAGE_DROP_FILES_DIR || filesDir
      }
    })
    if (child.stdout) {
      child.stdout.pipe(output, { end: false })
    }
    if (child.stderr) {
      child.stderr.pipe(output, { end: false })
    }
    child.once('close', () => {
      output.end()
    })
    return child
  }
}

async function loadModules() {
  if (modules) {
    return modules
  }

  const [menuStateModule, pathsModule, supervisorModule, autostartModule, controllerModule] =
    await Promise.all([
      import(toModuleUrl('menu-state.mjs')),
      import(toModuleUrl('paths.mjs')),
      import(toModuleUrl('supervisor.mjs')),
      import(toModuleUrl('autostart.mjs')),
      import(toModuleUrl('controller.mjs'))
    ])

  modules = {
    buildMenuTemplate: menuStateModule.buildMenuTemplate,
    resolveWindowsAgentPaths: pathsModule.resolveWindowsAgentPaths,
    createSupervisor: supervisorModule.createSupervisor,
    enableAutostart: autostartModule.enableAutostart,
    disableAutostart: autostartModule.disableAutostart,
    getAutostartStatus: autostartModule.getAutostartStatus,
    createAgentController: controllerModule.createAgentController
  }

  return modules
}

function toTrayMenuItem(item) {
  if (item.type === 'separator') {
    return { type: 'separator' }
  }

  const actionByLabel = {
    'Start Server': () => controller.startService(),
    'Stop Server': () => controller.stopService(),
    'Retry Start': () => controller.retryService(),
    'Autostart: On': () => controller.toggleAutostart(),
    'Autostart: Off': () => controller.toggleAutostart(),
    'View Logs': () => shell.showItemInFolder(resolvedPaths.logFile),
    Quit: () => shutdownAndQuit()
  }

  const action = actionByLabel[item.label]
  if (action) {
    return {
      label: item.label,
      click: async () => {
        await action()
      }
    }
  }

  return {
    label: item.label,
    enabled: item.enabled !== false
  }
}

async function refreshTrayMenu() {
  if (!tray || !controller) {
    return
  }

  const loaded = await loadModules()
  const mappedStateItems = loaded.buildMenuTemplate(controller.state).map(toTrayMenuItem)
  const menuItems = [
    {
      label: 'Open Message Drop',
      click: async () => {
        await shell.openExternal(APP_URL)
      }
    },
    { type: 'separator' },
    ...mappedStateItems,
    { type: 'separator' },
    {
      label: 'Open Data Folder',
      click: async () => {
        await shell.openPath(resolvedPaths.runtimeRoot)
      }
    }
  ]

  tray.setContextMenu(Menu.buildFromTemplate(menuItems))
  tray.setToolTip(`Message Drop (${controller.state.status})`)
}

async function shutdownAndQuit() {
  if (supervisor) {
    await supervisor.stop()
  }
  app.quit()
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png')
  if (existsSync(iconPath)) {
    return iconPath
  }
  return nativeImage.createEmpty()
}

async function bootstrap() {
  const loaded = await loadModules()
  resolvedPaths = loaded.resolveWindowsAgentPaths()

  supervisor = loaded.createSupervisor({
    spawnServer: createSpawnServer(resolvedPaths.logFile, resolvedPaths.runtimeRoot),
    healthProbe: createHealthProbe(HEALTH_URL, HEALTH_TIMEOUT_MS)
  })

  controller = loaded.createAgentController({
    supervisor,
    autostart: {
      enableAutostart: loaded.enableAutostart,
      disableAutostart: loaded.disableAutostart,
      getAutostartStatus: loaded.getAutostartStatus
    },
    refresh: refreshTrayMenu
  })

  tray = new Tray(createTrayIcon())
  tray.on('click', async () => {
    await shell.openExternal(APP_URL)
  })

  await controller.startOnLaunch()
}

app.whenReady().then(async () => {
  await bootstrap()
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})

app.on('before-quit', async () => {
  if (supervisor) {
    await supervisor.stop()
  }
})
