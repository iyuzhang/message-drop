/**
 * Runs the message-drop server either from a local checkout (tsx + src/server.ts)
 * or from packaged runtime assets bundled in the CLI tarball.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  findMessageDropRepoRootFromCli,
  resolveDefaultGlobalDataPaths,
  resolvePackagedRuntimePathsFromCli,
} from '../utils/paths.js'
import {
  isPidAlive,
  readDaemonState,
  resolveDaemonRuntimeFiles,
  type DaemonState,
} from '../utils/daemon-state.js'

interface ParsedStartFlags {
  host?: string
  port?: number
  dataDir?: string
  open: boolean
  foreground: boolean
}

const MESSAGE_DROP_URL_LINE =
  /message-drop: (?<url>https?:\/\/[^\s]+)/

interface StartExecutionTarget {
  readonly mode: 'repo-tsx' | 'packaged-runtime'
  readonly cwd: string
  readonly entryOrCli: string
  readonly serverEntry?: string
}

function resolveStartExecutionTarget(): StartExecutionTarget {
  const runtime = resolvePackagedRuntimePathsFromCli()
  if (runtime !== undefined) {
    return {
      mode: 'packaged-runtime',
      cwd: runtime.runtimeRoot,
      entryOrCli: runtime.serverEntry,
    }
  }

  const repoRoot = findMessageDropRepoRootFromCli()
  if (repoRoot !== undefined) {
    const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const serverEntry = join(repoRoot, 'src', 'server.ts')
    if (existsSync(tsxCli) && existsSync(serverEntry)) {
      return {
        mode: 'repo-tsx',
        cwd: repoRoot,
        entryOrCli: tsxCli,
        serverEntry,
      }
    }
  }

  throw new Error(
    'message-drop start: no runnable runtime found. Install from npm (latest) or run from a full message-drop checkout with dependencies installed.',
  )
}

function parsePort(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${value} (expected integer 1-65535)`)
  }
  return n
}

function parseStartFlags(argv: string[]): ParsedStartFlags {
  const out: ParsedStartFlags = { open: true, foreground: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) {
      break
    }
    if (arg === '--help' || arg === '-h') {
      return out
    }
    if (arg === '--open') {
      out.open = true
      continue
    }
    if (arg === '--foreground') {
      out.foreground = true
      continue
    }
    if (arg === '--host') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) {
        throw new Error('--host requires a value')
      }
      out.host = v
      continue
    }
    if (arg.startsWith('--host=')) {
      out.host = arg.slice('--host='.length)
      continue
    }
    if (arg === '--port') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) {
        throw new Error('--port requires a value')
      }
      out.port = parsePort(v)
      continue
    }
    if (arg.startsWith('--port=')) {
      out.port = parsePort(arg.slice('--port='.length))
      continue
    }
    if (arg === '--data-dir') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) {
        throw new Error('--data-dir requires a value')
      }
      out.dataDir = v
      continue
    }
    if (arg.startsWith('--data-dir=')) {
      out.dataDir = arg.slice('--data-dir='.length)
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return out
}

function buildChildEnv(
  flags: ParsedStartFlags,
  useGlobalDataDefaults: boolean,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (flags.host !== undefined) {
    env.HOST = flags.host
  }
  if (flags.port !== undefined) {
    env.PORT = String(flags.port)
  }
  if (flags.dataDir !== undefined) {
    env.MESSAGE_DROP_DATA_PATH = join(flags.dataDir, 'messages.json')
    env.MESSAGE_DROP_FILES_DIR = join(flags.dataDir, 'files')
  } else if (useGlobalDataDefaults) {
    const defaults = resolveDefaultGlobalDataPaths()
    if (env.MESSAGE_DROP_DATA_PATH === undefined) {
      env.MESSAGE_DROP_DATA_PATH = defaults.messagesFile
    }
    if (env.MESSAGE_DROP_FILES_DIR === undefined) {
      env.MESSAGE_DROP_FILES_DIR = defaults.filesDir
    }
  }
  return env
}

function displayHostForUrl(host: string): string {
  return host === '0.0.0.0' ? '127.0.0.1' : host
}

function effectiveHost(flags: ParsedStartFlags): string {
  if (flags.host !== undefined) {
    return flags.host
  }
  return process.env.HOST ?? '0.0.0.0'
}

function effectivePort(flags: ParsedStartFlags): number {
  if (flags.port !== undefined) {
    return flags.port
  }
  const raw = process.env.PORT
  if (raw !== undefined && raw !== '') {
    return parsePort(raw)
  }
  return 8787
}

function isCiEnvironment(): boolean {
  const v = process.env.CI
  return v === '1' || v?.toLowerCase() === 'true'
}

function printStartHelp(): void {
  console.log(`Usage: message-drop start [options]

Options:
  --host <addr>       Bind address (default: HOST env or 0.0.0.0)
  --port <port>       Listen port (default: PORT env or 8787)
  --data-dir <dir>    Store messages.json and files/ under this directory
                      (overrides MESSAGE_DROP_DATA_PATH / MESSAGE_DROP_FILES_DIR)
  --open              Open the server URL in a browser (default; skipped when CI is set; best-effort)
  --foreground        Keep process attached in foreground (debug/advanced)
  -h, --help          Show help`)
}

function openUrlBestEffort(url: string): void {
  if (isCiEnvironment()) {
    return
  }
  const platform = process.platform
  if (platform === 'darwin') {
    execFile('open', [url], () => {})
  } else if (platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {})
  } else {
    execFile('xdg-open', [url], () => {})
  }
}

function attachOpenOnUrlLine(child: ChildProcess, fallbackUrl: string): void {
  if (isCiEnvironment()) {
    return
  }
  const { stdout, stderr } = child
  if (stdout === null || stderr === null) {
    return
  }

  let opened = false
  let combined = ''

  const FALLBACK_MS = 4000
  const fallbackTimer = setTimeout(() => {
    if (opened) {
      return
    }
    opened = true
    openUrlBestEffort(fallbackUrl)
  }, FALLBACK_MS)

  const considerOpening = (): void => {
    if (opened) {
      return
    }
    const m = combined.match(MESSAGE_DROP_URL_LINE)
    const url = m?.groups?.url
    if (url !== undefined) {
      opened = true
      clearTimeout(fallbackTimer)
      openUrlBestEffort(url)
    }
  }

  const appendAndForward = (
    chunk: Buffer,
    stream: NodeJS.WriteStream,
  ): void => {
    const s = chunk.toString('utf8')
    stream.write(s)
    combined = (combined + s).slice(-12_000)
    considerOpening()
  }

  stdout.on('data', (ch: Buffer) => {
    appendAndForward(ch, process.stdout)
  })
  stderr.on('data', (ch: Buffer) => {
    appendAndForward(ch, process.stderr)
  })

  child.once('exit', () => {
    clearTimeout(fallbackTimer)
  })
}

export async function runStart(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printStartHelp()
    return
  }

  let flags: ParsedStartFlags
  try {
    flags = parseStartFlags(args)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    process.exitCode = 1
    return
  }

  let port: number
  try {
    port = effectivePort(flags)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(msg)
    process.exitCode = 1
    return
  }

  const target = resolveStartExecutionTarget()
  const childEnv = buildChildEnv(
    flags,
    target.mode === 'packaged-runtime',
  )
  const host = effectiveHost(flags)
  const fallbackOpenUrl = `http://${displayHostForUrl(host)}:${port}/`
  const runtimeFiles = resolveDaemonRuntimeFiles(flags.dataDir, childEnv)
  const commandArgs =
    target.mode === 'repo-tsx'
      ? [target.entryOrCli, target.serverEntry!]
      : [target.entryOrCli]

  if (!flags.foreground) {
    mkdirSync(runtimeFiles.stateDir, { recursive: true })
    const state = readDaemonState(runtimeFiles.pidFile)
    if (state !== null && isPidAlive(state.pid)) {
      console.log(
        `message-drop start: already running in background (pid ${state.pid})`,
      )
      console.log(`message-drop: ${state.url}`)
      console.log(`log: ${runtimeFiles.logFile}`)
      if (flags.open) {
        openUrlBestEffort(state.url)
      }
      return
    }
    if (existsSync(runtimeFiles.pidFile)) {
      rmSync(runtimeFiles.pidFile, { force: true })
    }
    const logFd = openSync(runtimeFiles.logFile, 'a')
    const daemon = spawn(process.execPath, commandArgs, {
      cwd: target.cwd,
      env: childEnv,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    })
    closeSync(logFd)
    daemon.unref()
    const pid = daemon.pid
    if (pid === undefined) {
      throw new Error('message-drop start: failed to obtain daemon pid')
    }
    const snapshot: DaemonState = {
      pid,
      url: fallbackOpenUrl,
      startedAt: new Date().toISOString(),
    }
    writeFileSync(runtimeFiles.pidFile, `${JSON.stringify(snapshot, null, 2)}\n`)
    console.log(`message-drop start: started in background (pid ${pid})`)
    console.log(`message-drop: ${fallbackOpenUrl}`)
    console.log(`log: ${runtimeFiles.logFile}`)
    if (flags.open) {
      openUrlBestEffort(fallbackOpenUrl)
    }
    return
  }

  const wantOpenWatcher = flags.open && !isCiEnvironment()
  const child = wantOpenWatcher
    ? spawn(process.execPath, commandArgs, {
        cwd: target.cwd,
        env: childEnv,
        stdio: ['inherit', 'pipe', 'pipe'],
      })
    : spawn(process.execPath, commandArgs, {
        cwd: target.cwd,
        env: childEnv,
        stdio: 'inherit',
      })
  if (wantOpenWatcher) {
    attachOpenOnUrlLine(child, fallbackOpenUrl)
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    child.on('error', (err) => {
      console.error('message-drop start: failed to spawn runtime', err)
      rejectPromise(err)
    })
    child.on('exit', (code, signal) => {
      if (signal !== null || code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(
        new Error(`message-drop server exited with code ${code ?? 'unknown'}`),
      )
    })
  })
}
