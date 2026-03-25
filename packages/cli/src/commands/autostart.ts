/**
 * Handles the autostart command (platform-specific providers).
 */
import type { AutostartMutationReport } from '../autostart/types.js'
import {
  createAutostartContextFromProcess,
  resolveAutostartProvider,
} from '../autostart/provider-factory.js'

function printAutostartHelp(): void {
  console.log(`Usage: message-drop autostart <subcommand>

Subcommands:
  enable    Turn on autostart for this OS (best-effort)
  disable   Turn off autostart for this OS (best-effort)
  status    Show whether autostart is configured

Linux (systemd --user): enable writes or updates ~/.config/systemd/user/message-drop-autostart.service
  (or $XDG_CONFIG_HOME/systemd/user/...) to run "message-drop start", then daemon-reloads and enables
  the unit. disable stops the unit from starting at login but leaves the unit file in place (remove it
  manually if you want it gone). Override the binary in the unit with MESSAGE_DROP_AUTOSTART_BIN.

Options:
  -h, --help  Show help`)
}

function assertNoExtraArgs(sub: string, rest: string[]): boolean {
  const badFlag = rest.find((a) => a.startsWith('-'))
  if (badFlag !== undefined) {
    console.error(`Unknown option for ${sub}: ${badFlag}`)
    process.exitCode = 1
    return false
  }
  if (rest.length > 0) {
    console.error(`${sub} does not take positional arguments`)
    process.exitCode = 1
    return false
  }
  return true
}

function printMutationReport(report: AutostartMutationReport): void {
  for (const line of report.lines) {
    console.log(line)
  }
  if (report.isError) {
    process.exitCode = 1
  }
}

export async function runAutostart(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printAutostartHelp()
    return
  }

  const sub = args[0]
  if (sub === undefined) {
    printAutostartHelp()
    return
  }

  if (sub === 'status' || sub === 'enable' || sub === 'disable') {
    const rest = args.slice(1)
    if (!assertNoExtraArgs(sub, rest)) {
      return
    }

    const ctx = createAutostartContextFromProcess()
    const provider = resolveAutostartProvider(ctx)

    if (sub === 'status') {
      const report = await provider.status(ctx)
      for (const line of report.lines) {
        console.log(line)
      }
      if (report.isError) {
        process.exitCode = 1
      }
      return
    }

    if (sub === 'enable') {
      const report = await provider.enable(ctx)
      printMutationReport(report)
      return
    }

    const report = await provider.disable(ctx)
    printMutationReport(report)
    return
  }

  console.error(`Unknown autostart subcommand: ${sub}`)
  printAutostartHelp()
  process.exitCode = 1
}
