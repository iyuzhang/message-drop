/**
 * Resolves repository and data paths used by CLI diagnostics.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function scanUpwardForRepoRoot(startDir: string): string | undefined {
  let dir = resolve(startDir)
  for (let depth = 0; depth < 24; depth++) {
    const serverTs = join(dir, 'src', 'server.ts')
    const workspace = join(dir, 'pnpm-workspace.yaml')
    const rootPkg = join(dir, 'package.json')
    if (
      existsSync(serverTs) &&
      existsSync(workspace) &&
      isMessageDropWorkspacePackage(rootPkg)
    ) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return undefined
}

function isMessageDropWorkspacePackage(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) {
    return false
  }
  try {
    const raw = readFileSync(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown }
    return parsed.name === 'message-drop-workspace'
  } catch {
    return false
  }
}

/**
 * Finds a message-drop workspace root.
 *
 * Priority:
 * 1) walk upward from this CLI module location (development checkout / linked CLI)
 * 2) walk upward from process.cwd() (global install invoked from a checkout path)
 */
export function findMessageDropRepoRootFromCli(): string | undefined {
  const fromModule = scanUpwardForRepoRoot(
    dirname(fileURLToPath(import.meta.url)),
  )
  if (fromModule !== undefined) {
    return fromModule
  }
  return scanUpwardForRepoRoot(process.cwd())
}

export interface GlobalDataPaths {
  readonly messagesFile: string
  readonly filesDir: string
}

function defaultGlobalDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg !== undefined && xdg !== '') {
    return join(resolve(xdg), 'message-drop')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'message-drop')
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData !== undefined && appData !== '') {
      return join(resolve(appData), 'message-drop')
    }
  }
  return join(homedir(), '.local', 'share', 'message-drop')
}

export function resolveDefaultGlobalDataPaths(): GlobalDataPaths {
  const base = defaultGlobalDataDir()
  return {
    messagesFile: join(base, 'messages.json'),
    filesDir: join(base, 'files'),
  }
}

export interface PackagedRuntimePaths {
  readonly runtimeRoot: string
  readonly serverEntry: string
}

export function resolvePackagedRuntimePathsFromCli():
  | PackagedRuntimePaths
  | undefined {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const distRoot = resolve(moduleDir, '..')
  const runtimeRoot = join(distRoot, 'runtime')
  const serverEntry = join(runtimeRoot, 'server', 'server.js')
  if (!existsSync(serverEntry)) {
    return undefined
  }
  return {
    runtimeRoot,
    serverEntry,
  }
}

/**
 * Resolves a path the same way the running server treats it when cwd is the repo root (CLI start): relative paths are from repo root if known, else from process.cwd(). Absolute paths are normalized via resolve().
 */
function resolveLikeRunningServer(
  value: string,
  repo: string | undefined,
): string {
  if (value === '') {
    return ''
  }
  if (isAbsolute(value)) {
    return resolve(value)
  }
  const base = repo ?? process.cwd()
  return resolve(base, value)
}

export interface EffectiveServerDataPaths {
  /** Absolute messages.json path, or empty if it cannot be resolved. */
  readonly messagesFile: string
  /** Absolute uploads directory, or empty if it cannot be resolved. */
  readonly filesDir: string
  readonly messagesFromEnv: boolean
  readonly filesFromEnv: boolean
  /** Explains asymmetric env (only one of the two vars set) or missing checkout. */
  readonly configNotes: readonly string[]
  /** Neither path is known (no env and no checkout). */
  readonly unconfigured: boolean
}

/**
 * Resolves effective MESSAGE_DROP_DATA_PATH and MESSAGE_DROP_FILES_DIR like src/start-server.ts (same ?? rules), then absolutizes relative values like a server whose cwd is the checkout root.
 */
export function resolveEffectiveServerDataPaths(): EffectiveServerDataPaths {
  const repo = findMessageDropRepoRootFromCli()
  const globalDefaults = resolveDefaultGlobalDataPaths()
  const defaultMessages =
    repo !== undefined
      ? join(repo, 'data', 'messages.json')
      : globalDefaults.messagesFile
  const defaultFiles =
    repo !== undefined ? join(repo, 'data', 'files') : globalDefaults.filesDir

  const envMessages = process.env.MESSAGE_DROP_DATA_PATH
  const envFiles = process.env.MESSAGE_DROP_FILES_DIR

  const rawMessages = envMessages ?? defaultMessages
  const rawFiles = envFiles ?? defaultFiles

  const messagesFromEnv = envMessages !== undefined
  const filesFromEnv = envFiles !== undefined

  const configNotes: string[] = []

  if (messagesFromEnv && !filesFromEnv && repo !== undefined) {
    configNotes.push(
      `MESSAGE_DROP_FILES_DIR is unset; the server still stores uploads under ${resolveLikeRunningServer(defaultFiles, repo)} (checkout default). Set MESSAGE_DROP_FILES_DIR to override.`,
    )
  }
  if (!messagesFromEnv && filesFromEnv && repo !== undefined) {
    configNotes.push(
      `MESSAGE_DROP_DATA_PATH is unset; the server still stores messages at ${resolveLikeRunningServer(defaultMessages, repo)} (checkout default). Set MESSAGE_DROP_DATA_PATH to override.`,
    )
  }
  if (messagesFromEnv && !filesFromEnv && repo === undefined) {
    configNotes.push(
      `MESSAGE_DROP_FILES_DIR is unset; uploads default to ${resolveLikeRunningServer(defaultFiles, repo)} (global default). Set MESSAGE_DROP_FILES_DIR to override.`,
    )
  }
  if (!messagesFromEnv && filesFromEnv && repo === undefined) {
    configNotes.push(
      `MESSAGE_DROP_DATA_PATH is unset; messages default to ${resolveLikeRunningServer(defaultMessages, repo)} (global default). Set MESSAGE_DROP_DATA_PATH to override.`,
    )
  }

  const messagesFile =
    rawMessages !== '' ? resolveLikeRunningServer(rawMessages, repo) : ''
  const filesDir =
    rawFiles !== '' ? resolveLikeRunningServer(rawFiles, repo) : ''

  const unconfigured =
    messagesFile === '' &&
    filesDir === '' &&
    !messagesFromEnv &&
    !filesFromEnv

  return {
    messagesFile,
    filesDir,
    messagesFromEnv,
    filesFromEnv,
    configNotes,
    unconfigured,
  }
}
