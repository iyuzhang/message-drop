import { existsSync } from 'node:fs'
import { isPidAlive, readDaemonState, resolveDaemonRuntimeFiles } from '../utils/daemon-state.js'

interface StatusFlags {
  dataDir?: string
}

function parseStatusFlags(argv: string[]): StatusFlags {
  const out: StatusFlags = {}
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

function printStatusHelp(): void {
  console.log(`Usage: message-drop status [options]

Options:
  --data-dir <dir>  Use this data directory to resolve daemon pid/log files
  -h, --help        Show help`)
}

export async function runStatus(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printStatusHelp()
    return
  }
  let flags: StatusFlags
  try {
    flags = parseStatusFlags(args)
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
    return
  }
  const files = resolveDaemonRuntimeFiles(flags.dataDir)
  if (!existsSync(files.pidFile)) {
    console.log('message-drop status: not running')
    console.log(`pid file: ${files.pidFile}`)
    process.exitCode = 1
    return
  }
  const state = readDaemonState(files.pidFile)
  if (state === null || !isPidAlive(state.pid)) {
    console.log('message-drop status: not running (stale pid file)')
    console.log(`pid file: ${files.pidFile}`)
    process.exitCode = 1
    return
  }
  console.log(`message-drop status: running (pid ${state.pid})`)
  console.log(`message-drop: ${state.url}`)
  console.log(`started_at: ${state.startedAt}`)
  console.log(`log: ${files.logFile}`)
}

