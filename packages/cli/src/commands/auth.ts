import { rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  findMessageDropRepoRootFromCli,
  resolveDefaultGlobalDataPaths,
  resolveEffectiveServerDataPaths,
  resolvePackagedRuntimePathsFromCli,
} from '../utils/paths.js'

interface AuthFlags {
  dataDir?: string
}

function printAuthHelp(): void {
  console.log(`Usage: message-drop auth <subcommand> [options]

Subcommands:
  reset              Remove persisted auth password config (auth.json)

Options:
  --data-dir <dir>   Use this data directory when resolving auth.json
  -h, --help         Show help`)
}

function printAuthResetHelp(): void {
  console.log(`Usage: message-drop auth reset [options]

Removes persisted password configuration file (auth.json).

Options:
  --data-dir <dir>   Use this data directory when resolving auth.json
  -h, --help         Show help`)
}

function parseAuthFlags(argv: string[]): AuthFlags {
  const out: AuthFlags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) break
    if (arg === '--help' || arg === '-h') {
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
      const v = arg.slice('--data-dir='.length)
      if (v === '') {
        throw new Error('--data-dir requires a non-empty value')
      }
      out.dataDir = v
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return out
}

function resolveStartLikeCwd(): string {
  const runtime = resolvePackagedRuntimePathsFromCli()
  if (runtime !== undefined) {
    return runtime.runtimeRoot
  }
  const repo = findMessageDropRepoRootFromCli()
  if (repo !== undefined) {
    return repo
  }
  return process.cwd()
}

function resolveAuthFilePath(flags: AuthFlags): string {
  if (flags.dataDir !== undefined && flags.dataDir !== '') {
    const dataDir = isAbsolute(flags.dataDir)
      ? resolve(flags.dataDir)
      : resolve(resolveStartLikeCwd(), flags.dataDir)
    return join(dataDir, 'auth.json')
  }
  const effective = resolveEffectiveServerDataPaths()
  const messages = effective.messagesFile
  if (messages !== '') {
    return join(dirname(messages), 'auth.json')
  }
  const globalDefaults = resolveDefaultGlobalDataPaths()
  return join(dirname(globalDefaults.messagesFile), 'auth.json')
}

async function runAuthReset(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printAuthResetHelp()
    return
  }
  let flags: AuthFlags
  try {
    flags = parseAuthFlags(args)
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
    return
  }
  const authFilePath = resolveAuthFilePath(flags)
  await rm(authFilePath, { force: true })
  console.log('message-drop auth reset: cleared persisted password config')
  console.log(`auth file: ${authFilePath}`)
  if (process.env.MESSAGE_DROP_SERVER_PASSWORD !== undefined) {
    console.log(
      'note: MESSAGE_DROP_SERVER_PASSWORD is set in current shell; env password still takes priority.',
    )
  }
  console.log('note: if daemon is running, restart it to apply changes.')
}

export async function runAuth(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printAuthHelp()
    return
  }
  const sub = args[0]
  const rest = args.slice(1)
  if (sub === 'reset') {
    await runAuthReset(rest)
    return
  }
  console.error(`Unknown auth subcommand: ${sub}`)
  printAuthHelp()
  process.exitCode = 1
}
