import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { resolveWindowsAgentPaths } from './paths.mjs'

const MARKER_FILE_NAME = 'autostart-enabled.json'
const SCRIPT_FILE_NAME = 'message-drop-agent.cmd'

function toAbsolutePath(candidatePath, fallbackPath) {
  if (!candidatePath) {
    return fallbackPath
  }
  return path.isAbsolute(candidatePath) ? candidatePath : path.resolve(candidatePath)
}

function resolveAutostartPaths(inputPaths) {
  if (inputPaths?.autostartMarkerFile && inputPaths?.startupScriptFile) {
    return {
      autostartMarkerFile: inputPaths.autostartMarkerFile,
      startupScriptFile: inputPaths.startupScriptFile,
      agentExecutablePath: toAbsolutePath(
        inputPaths.agentExecutablePath,
        toAbsolutePath(process.env.MESSAGE_DROP_AGENT_EXECUTABLE_PATH, process.execPath)
      ),
      agentEntryPath: inputPaths.agentEntryPath
    }
  }

  const resolved = resolveWindowsAgentPaths()
  const startupDir = path.win32.join(
    resolved.roamingAppData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  )

  return {
    autostartMarkerFile: path.win32.join(resolved.configRoot, MARKER_FILE_NAME),
    startupScriptFile: path.win32.join(startupDir, SCRIPT_FILE_NAME),
    agentExecutablePath: toAbsolutePath(process.env.MESSAGE_DROP_AGENT_EXECUTABLE_PATH, process.execPath),
    agentEntryPath: process.env.MESSAGE_DROP_AGENT_ENTRY_PATH
      ? toAbsolutePath(process.env.MESSAGE_DROP_AGENT_ENTRY_PATH, process.env.MESSAGE_DROP_AGENT_ENTRY_PATH)
      : null
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function buildStartupScriptContent(agentExecutablePath, agentEntryPath) {
  if (!path.isAbsolute(agentExecutablePath)) {
    throw new Error('agentExecutablePath must be absolute for autostart.')
  }
  const escapedEntry = agentEntryPath ? ` "${agentEntryPath}"` : ''
  return `@echo off\r\nstart "" "${agentExecutablePath}"${escapedEntry}\r\n`
}

function getDirectoryName(filePath) {
  if (filePath.includes('\\')) {
    return path.win32.dirname(filePath)
  }
  return path.dirname(filePath)
}

export async function enableAutostart(paths) {
  const resolvedPaths = resolveAutostartPaths(paths)
  await mkdir(getDirectoryName(resolvedPaths.autostartMarkerFile), { recursive: true })
  await mkdir(getDirectoryName(resolvedPaths.startupScriptFile), { recursive: true })
  await writeFile(
    resolvedPaths.autostartMarkerFile,
    JSON.stringify({ enabled: true }, null, 2) + '\n',
    'utf8'
  )
  await writeFile(
    resolvedPaths.startupScriptFile,
    buildStartupScriptContent(resolvedPaths.agentExecutablePath, resolvedPaths.agentEntryPath),
    'utf8'
  )
  return getAutostartStatus(resolvedPaths)
}

export async function disableAutostart(paths) {
  const resolvedPaths = resolveAutostartPaths(paths)
  await rm(resolvedPaths.autostartMarkerFile, { force: true })
  await rm(resolvedPaths.startupScriptFile, { force: true })
  return getAutostartStatus(resolvedPaths)
}

export async function getAutostartStatus(paths) {
  const resolvedPaths = resolveAutostartPaths(paths)
  const markerExists = await fileExists(resolvedPaths.autostartMarkerFile)
  const scriptExists = await fileExists(resolvedPaths.startupScriptFile)
  let markerEnabled = false

  if (markerExists) {
    try {
      const raw = await readFile(resolvedPaths.autostartMarkerFile, 'utf8')
      const parsed = JSON.parse(raw)
      markerEnabled = parsed?.enabled === true
    } catch {
      markerEnabled = false
    }
  }

  return {
    enabled: markerEnabled && scriptExists,
    markerExists,
    scriptExists,
    markerPath: resolvedPaths.autostartMarkerFile,
    scriptPath: resolvedPaths.startupScriptFile,
    agentExecutablePath: resolvedPaths.agentExecutablePath,
    agentEntryPath: resolvedPaths.agentEntryPath
  }
}
