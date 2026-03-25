/**
 * Implements a deterministic unsupported autostart provider.
 */
import type {
  AutostartContext,
  AutostartMutationReport,
  AutostartProvider,
  AutostartStatusReport,
  UnsupportedAutostartReason,
} from '../types.js'

const UNSUPPORTED_HEADER =
  'Autostart is not supported on this platform or environment.'

const ENABLE_FAIL_HEAD =
  'autostart enable: not supported on this platform or environment.' as const

const DISABLE_FAIL_HEAD =
  'autostart disable: not supported on this platform or environment.' as const

const LINUX_NO_SYSTEMD_LINES = [
  UNSUPPORTED_HEADER,
  '',
  'systemd --user does not appear to be available. To use autostart on Linux:',
  '  - Use a distribution with systemd and a logged-in user session (graphical or lingering).',
  '  - Enable lingering so user units run without an active login: loginctl enable-linger "$USER"',
  '  - Then run: message-drop autostart enable',
  '',
  'Alternatively, add "message-drop start" to your desktop environment startup applications.',
] as const

const PLATFORM_LINES = [
  UNSUPPORTED_HEADER,
  '',
  'message-drop autostart currently supports:',
  '  - Linux with systemd (user units)',
  '  - Windows (Startup folder shortcut)',
] as const

const FORCED_LINES = [
  UNSUPPORTED_HEADER,
  '',
  '(MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER=unsupported)',
] as const

const FORCED_ENABLE_LINES = [
  ENABLE_FAIL_HEAD,
  UNSUPPORTED_HEADER,
  '',
  '(MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER=unsupported)',
] as const

const FORCED_DISABLE_LINES = [
  DISABLE_FAIL_HEAD,
  UNSUPPORTED_HEADER,
  '',
  '(MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER=unsupported)',
] as const

function linesForReason(
  reason: UnsupportedAutostartReason,
): readonly string[] {
  if (reason === 'linux-no-systemd') {
    return LINUX_NO_SYSTEMD_LINES
  }
  if (reason === 'forced') {
    return FORCED_LINES
  }
  return PLATFORM_LINES
}

function enableLines(reason: UnsupportedAutostartReason): readonly string[] {
  if (reason === 'forced') {
    return FORCED_ENABLE_LINES
  }
  return [ENABLE_FAIL_HEAD, '', ...linesForReason(reason)]
}

function disableLines(reason: UnsupportedAutostartReason): readonly string[] {
  if (reason === 'forced') {
    return FORCED_DISABLE_LINES
  }
  return [DISABLE_FAIL_HEAD, '', ...linesForReason(reason)]
}

export function createUnsupportedProvider(
  reason: UnsupportedAutostartReason,
): AutostartProvider {
  return {
    id: 'unsupported',

    async status(_ctx: AutostartContext): Promise<AutostartStatusReport> {
      const lines = [...linesForReason(reason)]
      return {
        providerId: 'unsupported',
        state: 'not-installed',
        lines,
        isError: true,
        unsupportedReason: reason,
      }
    },

    async enable(_ctx: AutostartContext): Promise<AutostartMutationReport> {
      return {
        providerId: 'unsupported',
        lines: [...enableLines(reason)],
        isError: true,
      }
    },

    async disable(_ctx: AutostartContext): Promise<AutostartMutationReport> {
      return {
        providerId: 'unsupported',
        lines: [...disableLines(reason)],
        isError: true,
      }
    },
  }
}
