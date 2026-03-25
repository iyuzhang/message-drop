/**
 * Implements autostart via systemd --user for Linux.
 */
import { execFile, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type {
  AutostartContext,
  AutostartMutationReport,
  AutostartProvider,
  AutostartStatusReport,
} from '../types.js'
import { AUTOSTART_SERVICE_NAME } from '../types.js'

const execFileAsync = promisify(execFile)

const SYSTEMCTL_ENV_KEY = 'MESSAGE_DROP_SYSTEMCTL_PATH' as const

/** When set, used as the message-drop binary path in the generated user unit (tests / non-PATH installs). */
export const MESSAGE_DROP_AUTOSTART_BIN_ENV =
  'MESSAGE_DROP_AUTOSTART_BIN' as const

export function systemctlBinary(ctx: AutostartContext): string {
  const fromEnv = ctx.env[SYSTEMCTL_ENV_KEY]
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv
  }
  return 'systemctl'
}

function xdgConfigHome(ctx: AutostartContext): string {
  const fromEnv = ctx.env.XDG_CONFIG_HOME
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv
  }
  return join(ctx.homedir, '.config')
}

function userSystemdUserDir(ctx: AutostartContext): string {
  return join(xdgConfigHome(ctx), 'systemd', 'user')
}

function userUnitPath(ctx: AutostartContext): string {
  return join(userSystemdUserDir(ctx), AUTOSTART_SERVICE_NAME)
}

function bufferLikeToString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }
  return ''
}

function formatSystemdExecStart(argv: string[]): string {
  return argv
    .map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(' ')
}

function resolveMessageDropExecArgv(
  ctx: AutostartContext,
):
  | { ok: true; argv: string[] }
  | { ok: false; message: string } {
  const override = ctx.env[MESSAGE_DROP_AUTOSTART_BIN_ENV]
  if (override !== undefined && override !== '') {
    return { ok: true, argv: [override, 'start'] }
  }
  try {
    const out = execFileSync('which', ['message-drop'], {
      env: ctx.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    }).trim()
    if (out !== '') {
      return { ok: true, argv: [out, 'start'] }
    }
  } catch {
    // Fall through to CLI entry path.
  }
  const entry = ctx.cliEntryPath
  if (entry === '') {
    return {
      ok: false,
      message:
        'Could not resolve message-drop for the unit (not on PATH and no CLI entry path). Set MESSAGE_DROP_AUTOSTART_BIN or install the CLI on PATH.',
    }
  }
  return { ok: true, argv: [process.execPath, resolve(entry), 'start'] }
}

function buildUserUnitContents(execStartLine: string): string {
  return `[Unit]
Description=Message Drop server (message-drop start)

[Service]
Type=simple
ExecStart=${execStartLine}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
}

function reportFromIsEnabled(
  stdout: string,
  exitCode: number,
): AutostartStatusReport {
  const text = stdout.trim()
  if (exitCode === 0 && (text === 'enabled' || text === 'enabled-runtime')) {
    return {
      providerId: 'linux-systemd',
      state: 'installed-active',
      lines: [
        `systemd (user): ${AUTOSTART_SERVICE_NAME} is enabled (active on next login or after daemon-reload).`,
      ],
      isError: false,
    }
  }
  if (
    exitCode === 1 &&
    (text === 'disabled' ||
      text === 'indirect' ||
      text === 'masked' ||
      text === 'static')
  ) {
    return {
      providerId: 'linux-systemd',
      state: 'installed-inactive',
      lines: [
        `systemd (user): ${AUTOSTART_SERVICE_NAME} is present but not enabled (state: ${text}).`,
        `Run: message-drop autostart enable`,
      ],
      isError: false,
    }
  }
  if (exitCode === 1 && text === 'not-found') {
    return {
      providerId: 'linux-systemd',
      state: 'not-installed',
      lines: [
        `systemd (user): ${AUTOSTART_SERVICE_NAME} is not installed.`,
        `Run: message-drop autostart enable (installs a user unit under your XDG config directory, then enables it).`,
      ],
      isError: false,
    }
  }
  return {
    providerId: 'linux-systemd',
    state: 'unknown',
    lines: [
      `systemd (user): could not interpret is-enabled output (exit=${exitCode}): ${text || '(empty)'}`,
    ],
    isError: true,
  }
}

async function runIsEnabled(
  ctx: AutostartContext,
): Promise<
  | { kind: 'ok'; stdout: string; exitCode: number }
  | { kind: 'spawn-failed'; message: string }
> {
  const bin = systemctlBinary(ctx)
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['--user', 'is-enabled', AUTOSTART_SERVICE_NAME],
      {
        env: ctx.env,
        encoding: 'utf8',
        windowsHide: true,
      },
    )
    return { kind: 'ok', stdout, exitCode: 0 }
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code?: unknown }).code
      if (typeof code === 'number') {
        return {
          kind: 'ok',
          stdout: bufferLikeToString((err as { stdout?: unknown }).stdout),
          exitCode: code,
        }
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'spawn-failed', message: msg }
  }
}

async function runSystemctlUser(
  ctx: AutostartContext,
  args: string[],
): Promise<AutostartMutationReport> {
  const bin = systemctlBinary(ctx)
  try {
    const { stdout, stderr } = await execFileAsync(bin, ['--user', ...args], {
      env: ctx.env,
      encoding: 'utf8',
      windowsHide: true,
    })
    const out = [stdout, stderr].map((s) => s.trim()).filter(Boolean).join('\n')
    const cmdLabel =
      args[0] === 'daemon-reload'
        ? 'daemon-reload'
        : args.join(' ')
    return {
      providerId: 'linux-systemd',
      lines: [
        `systemd (user): ${cmdLabel}`,
        ...(out !== '' ? [out] : []),
      ],
      isError: false,
    }
  } catch (err: unknown) {
    const stdout = bufferLikeToString(
      typeof err === 'object' && err !== null && 'stdout' in err
        ? (err as { stdout?: unknown }).stdout
        : undefined,
    )
    const stderr = bufferLikeToString(
      typeof err === 'object' && err !== null && 'stderr' in err
        ? (err as { stderr?: unknown }).stderr
        : undefined,
    )
    const msg = err instanceof Error ? err.message : String(err)
    const detail = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join('\n')
    const cmdLabel =
      args[0] === 'daemon-reload'
        ? 'daemon-reload'
        : args.join(' ')
    return {
      providerId: 'linux-systemd',
      lines: [
        `systemd (user): ${cmdLabel} failed.`,
        detail !== '' ? detail : msg,
      ],
      isError: true,
    }
  }
}

async function installOrUpdateUserUnit(
  ctx: AutostartContext,
): Promise<AutostartMutationReport> {
  const resolved = resolveMessageDropExecArgv(ctx)
  if (!resolved.ok) {
    return {
      providerId: 'linux-systemd',
      lines: [
        `systemd (user): could not write ${AUTOSTART_SERVICE_NAME}.`,
        resolved.message,
      ],
      isError: true,
    }
  }
  const dir = userSystemdUserDir(ctx)
  const path = userUnitPath(ctx)
  const execLine = formatSystemdExecStart(resolved.argv)
  const body = buildUserUnitContents(execLine)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, body, { encoding: 'utf8', mode: 0o644 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      providerId: 'linux-systemd',
      lines: [
        `systemd (user): failed to write user unit at ${path}.`,
        msg,
      ],
      isError: true,
    }
  }
  return {
    providerId: 'linux-systemd',
    lines: [
      `systemd (user): wrote user unit ${path}`,
      `systemd (user): ExecStart=${execLine}`,
    ],
    isError: false,
  }
}

function mergeMutationReports(
  a: AutostartMutationReport,
  b: AutostartMutationReport,
): AutostartMutationReport {
  return {
    providerId: 'linux-systemd',
    lines: [...a.lines, ...b.lines],
    isError: a.isError || b.isError,
  }
}

export function createLinuxSystemdProvider(): AutostartProvider {
  return {
    id: 'linux-systemd',

    async status(ctx: AutostartContext): Promise<AutostartStatusReport> {
      const result = await runIsEnabled(ctx)
      if (result.kind === 'spawn-failed') {
        const bin = systemctlBinary(ctx)
        return {
          providerId: 'linux-systemd',
          state: 'unknown',
          lines: [
            `systemd (user): failed to run "${bin} --user is-enabled ${AUTOSTART_SERVICE_NAME}".`,
            result.message,
          ],
          isError: true,
        }
      }
      return reportFromIsEnabled(result.stdout, result.exitCode)
    },

    async enable(ctx: AutostartContext): Promise<AutostartMutationReport> {
      const writeReport = await installOrUpdateUserUnit(ctx)
      if (writeReport.isError) {
        return writeReport
      }
      const reload = await runSystemctlUser(ctx, ['daemon-reload'])
      if (reload.isError) {
        return mergeMutationReports(writeReport, reload)
      }
      const enable = await runSystemctlUser(ctx, ['enable', AUTOSTART_SERVICE_NAME])
      return mergeMutationReports(
        mergeMutationReports(writeReport, reload),
        enable,
      )
    },

    async disable(ctx: AutostartContext): Promise<AutostartMutationReport> {
      const disable = await runSystemctlUser(ctx, ['disable', AUTOSTART_SERVICE_NAME])
      const unitPath = userUnitPath(ctx)
      if (disable.isError) {
        return disable
      }
      return {
        providerId: 'linux-systemd',
        lines: [
          ...disable.lines,
          `systemd (user): user unit file left at ${unitPath} (remove manually if you no longer want it; disabling stops it from starting at login).`,
        ],
        isError: false,
      }
    },
  }
}
