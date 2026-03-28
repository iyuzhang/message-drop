import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveDefaultGlobalDataPaths } from './paths.js'

export interface DaemonRuntimeFiles {
  readonly stateDir: string
  readonly pidFile: string
  readonly logFile: string
}

export interface DaemonState {
  readonly pid: number
  readonly url: string
  readonly startedAt: string
}

export function resolveDaemonRuntimeFiles(
  dataDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DaemonRuntimeFiles {
  let messagesPath: string
  if (dataDir !== undefined && dataDir !== '') {
    messagesPath = join(dataDir, 'messages.json')
  } else if (env.MESSAGE_DROP_DATA_PATH !== undefined) {
    messagesPath = env.MESSAGE_DROP_DATA_PATH
  } else {
    messagesPath = resolveDefaultGlobalDataPaths().messagesFile
  }
  const stateDir = dirname(resolve(messagesPath))
  return {
    stateDir,
    pidFile: join(stateDir, 'message-drop.pid'),
    logFile: join(stateDir, 'message-drop.log'),
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EPERM') {
      return true
    }
    return false
  }
}

export function readDaemonState(path: string): DaemonState | null {
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      pid?: unknown
      url?: unknown
      startedAt?: unknown
    }
    if (
      typeof parsed.pid === 'number' &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.url === 'string'
    ) {
      return {
        pid: parsed.pid,
        url: parsed.url,
        startedAt:
          typeof parsed.startedAt === 'string'
            ? parsed.startedAt
            : new Date().toISOString(),
      }
    }
  } catch {
    // Ignore malformed file and treat as missing.
  }
  return null
}

