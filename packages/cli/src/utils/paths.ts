/**
 * Resolves repository and data paths used by CLI diagnostics.
 */
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Walks upward from this module to find a message-drop workspace root.
 */
export function findMessageDropRepoRootFromCli(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 24; depth++) {
    const serverTs = join(dir, 'src', 'server.ts')
    const workspace = join(dir, 'pnpm-workspace.yaml')
    if (existsSync(serverTs) && existsSync(workspace)) {
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
  const defaultMessages =
    repo !== undefined ? join(repo, 'data', 'messages.json') : ''
  const defaultFiles = repo !== undefined ? join(repo, 'data', 'files') : ''

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
      'MESSAGE_DROP_FILES_DIR is unset and no checkout was found — set MESSAGE_DROP_FILES_DIR to the uploads directory the server should use.',
    )
  }
  if (!messagesFromEnv && filesFromEnv && repo === undefined) {
    configNotes.push(
      'MESSAGE_DROP_DATA_PATH is unset and no checkout was found — set MESSAGE_DROP_DATA_PATH to the messages.json path the server should use.',
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
