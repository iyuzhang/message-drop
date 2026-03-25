/**
 * Defines autostart provider contracts and shared result shapes.
 */

export const AUTOSTART_SERVICE_NAME = 'message-drop-autostart.service' as const

export type AutostartProviderId =
  | 'linux-systemd'
  | 'windows-startup'
  | 'unsupported'

export type UnsupportedAutostartReason =
  | 'platform'
  | 'linux-no-systemd'
  | 'forced'

export interface AutostartContext {
  /** Full process environment (may include test overrides). */
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  /** Resolved home directory for config paths. */
  homedir: string
  /** Path to the running CLI entry (argv[1]). */
  cliEntryPath: string
}

export type AutostartStatusState =
  | 'not-installed'
  | 'installed-inactive'
  | 'installed-active'
  | 'unknown'

export interface AutostartStatusReport {
  providerId: AutostartProviderId
  state: AutostartStatusState
  /** Human-readable lines for stdout (no trailing newlines). */
  lines: string[]
  /** When true, the CLI should exit with code 1 after printing lines. */
  isError: boolean
  unsupportedReason?: UnsupportedAutostartReason
}

export interface AutostartMutationReport {
  providerId: AutostartProviderId
  lines: string[]
  /** When true, the CLI should exit with code 1 after printing lines. */
  isError: boolean
}

export interface AutostartProvider {
  readonly id: AutostartProviderId

  /** Reports whether autostart is configured and active for this provider. */
  status(ctx: AutostartContext): Promise<AutostartStatusReport>

  /** Turns on autostart for this provider (may write unit files or startup entries). */
  enable(ctx: AutostartContext): Promise<AutostartMutationReport>

  /** Turns off autostart for this provider. */
  disable(ctx: AutostartContext): Promise<AutostartMutationReport>
}
