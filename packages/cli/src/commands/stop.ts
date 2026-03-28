import { existsSync, rmSync } from 'node:fs'
import { isPidAlive, readDaemonState, resolveDaemonRuntimeFiles } from '../utils/daemon-state.js'

interface StopFlags {
  dataDir?: string
}

function parseStopFlags(argv: string[]): StopFlags {
  const out: StopFlags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) {
      break
    }
    if (arg === '--help' || arg === '-h') {
      return out
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

function printStopHelp(): void {
  console.log(`Usage: message-drop stop [options]

Options:
  --data-dir <dir>  Use this data directory to resolve daemon pid/log files
  -h, --help        Show help`)
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 120)
    })
  }
  return !isPidAlive(pid)
}

export async function runStop(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printStopHelp()
    return
  }
  let flags: StopFlags
  try {
    flags = parseStopFlags(args)
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
    return
  }
  const files = resolveDaemonRuntimeFiles(flags.dataDir)
  if (!existsSync(files.pidFile)) {
    console.log('message-drop stop: not running')
    return
  }
  const state = readDaemonState(files.pidFile)
  if (state === null || !isPidAlive(state.pid)) {
    rmSync(files.pidFile, { force: true })
    console.log('message-drop stop: removed stale pid file')
    return
  }
  try {
    process.kill(state.pid, 'SIGTERM')
  } catch (e: unknown) {
    console.error(
      `message-drop stop: failed to signal pid ${state.pid}: ${e instanceof Error ? e.message : String(e)}`,
    )
    process.exitCode = 1
    return
  }
  const exited = await waitForExit(state.pid, 5000)
  if (!exited) {
    console.error(
      `message-drop stop: pid ${state.pid} did not exit within timeout`,
    )
    process.exitCode = 1
    return
  }
  rmSync(files.pidFile, { force: true })
  console.log(`message-drop stop: stopped pid ${state.pid}`)
}

