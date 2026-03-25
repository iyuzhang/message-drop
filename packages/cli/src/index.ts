#!/usr/bin/env node
import { runAutostart } from './commands/autostart.js'
import { runDoctor } from './commands/doctor.js'
import { runStart } from './commands/start.js'

const USAGE = `message-drop — local messaging CLI

Commands:
  start       Run the HTTP server
  autostart   Show or manage autostart (see autostart --help)
  doctor      Diagnose environment for install/start

Options:
  -h, --help  Show help
`

type CommandRunner = (args: string[]) => Promise<void>

const ROUTER: Record<string, CommandRunner> = {
  start: runStart,
  autostart: runAutostart,
  doctor: runDoctor,
}

function printHelp(): void {
  console.log(USAGE)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const first = argv[0]

  if (first === undefined || first === '-h' || first === '--help') {
    printHelp()
    return
  }

  const run = ROUTER[first]
  if (run === undefined) {
    console.error(`Unknown command: ${first}`)
    printHelp()
    process.exitCode = 1
    return
  }

  const rest = argv.slice(1)
  if (rest[0] === '-h' || rest[0] === '--help') {
    await run(['--help'])
    return
  }

  await run(rest)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
