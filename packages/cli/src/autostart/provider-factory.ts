/**
 * Selects the autostart provider for the current OS and environment.
 */
import { execFileSync } from 'node:child_process'

import { homedir as osHomedir } from 'node:os'

import type { AutostartContext, AutostartProvider } from './types.js'
import {
  createLinuxSystemdProvider,
  systemctlBinary,
} from './providers/linux-systemd.js'
import { createWindowsStartupProvider } from './providers/windows-startup.js'
import { createUnsupportedProvider } from './providers/unsupported.js'

const FORCE_PROVIDER_ENV_KEY =
  'MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER' as const

const HOME_OVERRIDE_ENV_KEY = 'MESSAGE_DROP_AUTOSTART_HOME' as const

export function createAutostartContextFromProcess(): AutostartContext {
  const { env, platform, argv } = process
  const overrideHome = env[HOME_OVERRIDE_ENV_KEY]
  const resolvedHome =
    overrideHome !== undefined && overrideHome !== ''
      ? overrideHome
      : osHomedir()
  const cliEntryPath = argv[1] ?? ''
  return { env, platform, homedir: resolvedHome, cliEntryPath }
}

function parseForcedProviderId(
  raw: string | undefined,
): 'linux-systemd' | 'windows-startup' | 'unsupported' | null {
  if (raw === undefined || raw === '') {
    return null
  }
  if (raw === 'linux-systemd') {
    return 'linux-systemd'
  }
  if (raw === 'windows-startup') {
    return 'windows-startup'
  }
  if (raw === 'unsupported') {
    return 'unsupported'
  }
  return null
}

function systemctlVersionOk(ctx: AutostartContext): boolean {
  const bin = systemctlBinary(ctx)
  try {
    execFileSync(bin, ['--version'], {
      env: ctx.env,
      stdio: 'ignore',
      timeout: 4000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

export function resolveAutostartProvider(
  ctx: AutostartContext,
): AutostartProvider {
  const forced = parseForcedProviderId(ctx.env[FORCE_PROVIDER_ENV_KEY])
  if (forced === 'unsupported') {
    return createUnsupportedProvider('forced')
  }
  if (forced === 'linux-systemd') {
    return createLinuxSystemdProvider()
  }
  if (forced === 'windows-startup') {
    return createWindowsStartupProvider()
  }

  if (ctx.platform === 'win32') {
    return createWindowsStartupProvider()
  }

  if (ctx.platform === 'linux') {
    if (systemctlVersionOk(ctx)) {
      return createLinuxSystemdProvider()
    }
    return createUnsupportedProvider('linux-no-systemd')
  }

  return createUnsupportedProvider('platform')
}
