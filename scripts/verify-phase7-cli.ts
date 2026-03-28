/**
 * Verifies phase 7 CLI workspace layout, package metadata, help output, and start command.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_COMMANDS = ['start', 'autostart', 'doctor'] as const

const START_HELP_FLAGS = [
  '--host',
  '--port',
  '--data-dir',
  '--open',
  '--foreground',
] as const

interface CliPackageJson {
  name?: string
  bin?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
}

interface CliTsConfig {
  compilerOptions?: { outDir?: string; rootDir?: string }
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function assertHelpListsCommands(out: string, label: string): void {
  for (const cmd of REQUIRED_COMMANDS) {
    assert(
      out.includes(cmd),
      `${label}: help output must mention command "${cmd}"`,
    )
  }
}

function assertDoctorOutputContract(
  out: string,
  label: string,
  expectFailure: boolean,
): void {
  assert(
    out.includes('doctor-check node: ok'),
    `${label}: doctor must print node check`,
  )
  assert(
    out.includes('doctor-check port: info') &&
      out.includes('default 8787') &&
      out.includes('--port'),
    `${label}: doctor must print port guidance (default and --port)`,
  )
  assert(
    out.includes('EADDRINUSE'),
    `${label}: doctor must mention EADDRINUSE for port conflicts`,
  )
  const summaryLine = out
    .split('\n')
    .find((l) => l.startsWith('doctor: summary '))
  assert(
    summaryLine !== undefined,
    `${label}: doctor must print a deterministic summary line`,
  )
  const summaryRe =
    /^doctor: summary ok=(?<ok>\d+) warn=(?<warn>\d+) fail=(?<fail>\d+) exit=(?<exit>\d+)$/
  const m = summaryRe.exec(summaryLine.trim())
  assert(
    m !== null,
    `${label}: summary line must match ok/warn/fail/exit contract`,
  )
  const fail = Number(m.groups?.fail)
  const exitCode = Number(m.groups?.exit)
  assert(
    !Number.isNaN(fail) && !Number.isNaN(exitCode),
    `${label}: summary must use numeric counters`,
  )
  if (expectFailure) {
    assert(
      out.includes('doctor-check messages: fail'),
      `${label}: doctor must report messages path fail when parent is not a writable directory`,
    )
    assert(fail >= 1, `${label}: expected fail count >= 1`)
    assert(exitCode === 1, `${label}: expected exit=1 in summary when failing`)
  } else {
    assert(
      out.includes('doctor-check messages: ok'),
      `${label}: doctor must report messages path ok in this workspace`,
    )
    assert(
      out.includes('doctor-check files: ok'),
      `${label}: doctor must report files path ok in this workspace`,
    )
    assert(fail === 0, `${label}: expected fail=0`)
    assert(exitCode === 0, `${label}: expected exit=0 in summary`)
  }
}

async function fetchWithRetry(url: string, attempts = 40): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        return res
      }
    } catch (e) {
      lastErr = e
    }
    await new Promise<void>((r) => {
      setTimeout(r, 150)
    })
  }
  throw new Error(
    `fetch failed for ${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

async function waitForProcExit(
  proc: ChildProcess,
  ms: number,
): Promise<void> {
  await Promise.race([
    once(proc, 'exit'),
    new Promise<void>((r) => {
      setTimeout(r, ms)
    }),
  ])
}

async function verifyStartCommandReachesServer(
  root: string,
  label: string,
  command: string,
  commandPrefix: string[],
): Promise<void> {
  const port = 33_000 + Math.floor(Math.random() * 2000)
  const dataRoot = mkdtempSync(join(tmpdir(), 'md-start-foreground-'))
  const proc = spawn(
    command,
    [
      ...commandPrefix,
      'start',
      '--foreground',
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CI: 'true',
        MESSAGE_DROP_DATA_PATH: join(dataRoot, 'messages.json'),
        MESSAGE_DROP_FILES_DIR: join(dataRoot, 'files'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let buffer = ''
  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8')
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false
    let intervalId: ReturnType<typeof setInterval> | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    function finish(afterCleanup: () => void): void {
      if (settled) {
        return
      }
      settled = true
      if (intervalId !== undefined) {
        clearInterval(intervalId)
        intervalId = undefined
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      proc.stdout?.off('data', onData)
      proc.stderr?.off('data', onData)
      proc.off('exit', onProcExit)
      afterCleanup()
    }

    function onProcExit(
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void {
      finish(() => {
        if (signal === 'SIGTERM') {
          reject(
            new Error(
              `${label}: start received SIGTERM before URL (output=${buffer.slice(0, 400)})`,
            ),
          )
          return
        }
        reject(
          new Error(
            `${label}: start exited before URL (code=${code} signal=${signal}) output=${buffer.slice(0, 800)}`,
          ),
        )
      })
    }

    intervalId = setInterval(() => {
      const m = buffer.match(/message-drop: (http:\/\/[^\s]+)/)
      if (m) {
        finish(() => {
          resolve(m[1]!)
        })
      }
    }, 50)

    timeoutId = setTimeout(() => {
      finish(() => {
        proc.kill('SIGTERM')
        reject(new Error(`${label}: timeout waiting for message-drop URL`))
      })
    }, 20_000)

    proc.once('exit', onProcExit)
  })

  assert(
    url.includes(`:${port}/`) || url.includes(`:${port}`),
    `${label}: URL must include chosen port ${port}`,
  )

  const res = await fetchWithRetry(url)
  assert(res.ok, `${label}: GET ${url} expected ok, got ${res.status}`)

  proc.kill('SIGTERM')
  await waitForProcExit(proc, 5000)
}

function readPidFromState(path: string): number {
  const raw = readFileSync(path, 'utf8')
  const parsed = JSON.parse(raw) as { pid?: unknown }
  const pid = parsed.pid
  assert(
    typeof pid === 'number' && Number.isInteger(pid) && pid > 1,
    `pid state must include valid pid, got ${raw}`,
  )
  return pid
}

function killIfAlive(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Ignore already-exited process.
  }
}

async function verifyStartFromSimulatedGlobalInstall(
  root: string,
): Promise<void> {
  const fakePkgRoot = mkdtempSync(join(tmpdir(), 'md-cli-global-like-'))
  const fakeDistDir = join(fakePkgRoot, 'dist')
  cpSync(join(root, 'packages/cli/dist'), fakeDistDir, { recursive: true })
  const realNodeModules = join(root, 'packages/cli/node_modules')
  const fakeNodeModules = join(fakePkgRoot, 'node_modules')
  symlinkSync(realNodeModules, fakeNodeModules, 'dir')
  const fakeDistEntry = join(fakeDistDir, 'index.js')
  const fakeRunDir = mkdtempSync(join(tmpdir(), 'md-cli-global-cwd-'))

  const doctor = spawnSync('node', [fakeDistEntry, 'doctor'], {
    cwd: fakeRunDir,
    encoding: 'utf8',
  })
  assert(doctor.error === undefined, String(doctor.error))
  assert(
    doctor.status === 0,
    `global-like dist doctor failed: status=${doctor.status} stderr=${doctor.stderr}`,
  )
  const doctorOut = `${doctor.stdout}\n${doctor.stderr}`
  assert(
    doctorOut.includes('doctor-check messages: ok'),
    'global-like dist doctor must resolve writable messages path',
  )
  assert(
    doctorOut.includes('doctor-check files: ok'),
    'global-like dist doctor must resolve writable files path',
  )

  const port = 35_000 + Math.floor(Math.random() * 1000)
  const dataRoot = mkdtempSync(join(tmpdir(), 'md-start-daemon-'))
  const pidFile = join(dataRoot, 'message-drop.pid')
  const start = spawnSync(
    'node',
    [fakeDistEntry, 'start', '--port', String(port), '--host', '127.0.0.1'],
    {
      cwd: fakeRunDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        MESSAGE_DROP_DATA_PATH: join(dataRoot, 'messages.json'),
        MESSAGE_DROP_FILES_DIR: join(dataRoot, 'files'),
      },
    },
  )
  assert(start.error === undefined, String(start.error))
  assert(
    start.status === 0,
    `global-like dist daemon start failed: status=${start.status} stderr=${start.stderr}`,
  )
  const startOut = `${start.stdout}\n${start.stderr}`
  assert(
    startOut.includes('started in background'),
    'daemon start must report background startup',
  )
  assert(existsSync(pidFile), `daemon start must create pid file at ${pidFile}`)
  const pid = readPidFromState(pidFile)
  const url = `http://127.0.0.1:${port}/`
  const res = await fetchWithRetry(url)
  assert(res.ok, `global-like daemon GET ${url} expected ok, got ${res.status}`)

  const second = spawnSync(
    'node',
    [fakeDistEntry, 'start', '--port', String(port), '--host', '127.0.0.1'],
    {
      cwd: fakeRunDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        MESSAGE_DROP_DATA_PATH: join(dataRoot, 'messages.json'),
        MESSAGE_DROP_FILES_DIR: join(dataRoot, 'files'),
      },
    },
  )
  assert(second.error === undefined, String(second.error))
  assert(
    second.status === 0,
    `second daemon start should succeed without new process, got status=${second.status}`,
  )
  const secondOut = `${second.stdout}\n${second.stderr}`
  assert(
    secondOut.includes('already running in background'),
    'second daemon start must detect existing process',
  )
  const pid2 = readPidFromState(pidFile)
  assert(pid2 === pid, `daemon must reuse same pid: first=${pid} second=${pid2}`)
  killIfAlive(pid)
  if (existsSync(pidFile)) {
    rmSync(pidFile, { force: true })
  }
}

async function mainAsync(): Promise<void> {
  const root = repoRoot()
  const pkgPath = join(root, 'packages/cli/package.json')
  const tsconfigPath = join(root, 'packages/cli/tsconfig.json')
  const cliEntry = join(root, 'packages/cli/src/index.ts')
  const distEntry = join(root, 'packages/cli/dist/index.js')

  const pkg = readJson<CliPackageJson>(pkgPath)
  assert(pkg.name === 'message-drop', 'packages/cli name must be message-drop')
  assert(
    pkg.bin?.['message-drop'] === './dist/index.js',
    'bin.message-drop must map to ./dist/index.js',
  )
  const files = pkg.files ?? []
  for (const f of ['dist', 'README.md', 'LICENSE'] as const) {
    assert(files.includes(f), `package.json files must include "${f}"`)
  }
  assert(
    typeof pkg.scripts?.build === 'string' && pkg.scripts.build.length > 0,
    'packages/cli must define scripts.build',
  )

  const tsconfig = readJson<CliTsConfig>(tsconfigPath)
  assert(
    tsconfig.compilerOptions?.outDir === 'dist',
    'tsconfig compilerOptions.outDir must be "dist"',
  )
  assert(
    tsconfig.compilerOptions?.rootDir === 'src',
    'tsconfig compilerOptions.rootDir must be "src"',
  )

  const helpTsx = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, '--help'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  assert(helpTsx.error === undefined, String(helpTsx.error))
  assert(
    helpTsx.status === 0,
    `tsx CLI --help failed: status=${helpTsx.status} stderr=${helpTsx.stderr}`,
  )
  assertHelpListsCommands(
    `${helpTsx.stdout}\n${helpTsx.stderr}`,
    'tsx CLI --help',
  )

  const startHelpTsx = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'start', '--help'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  assert(startHelpTsx.error === undefined, String(startHelpTsx.error))
  assert(
    startHelpTsx.status === 0,
    `tsx start --help failed: status=${startHelpTsx.status} stderr=${startHelpTsx.stderr}`,
  )
  const startHelpOut = `${startHelpTsx.stdout}\n${startHelpTsx.stderr}`
  for (const flag of START_HELP_FLAGS) {
    assert(
      startHelpOut.includes(flag),
      `tsx start --help must mention "${flag}"`,
    )
  }

  const doctorHelpTsx = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'doctor', '--help'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  assert(doctorHelpTsx.error === undefined, String(doctorHelpTsx.error))
  assert(
    doctorHelpTsx.status === 0,
    `tsx doctor --help failed: status=${doctorHelpTsx.status} stderr=${doctorHelpTsx.stderr}`,
  )
  const doctorHelpOut = `${doctorHelpTsx.stdout}\n${doctorHelpTsx.stderr}`
  assert(
    doctorHelpOut.includes('Usage: message-drop doctor'),
    'tsx doctor --help must print usage header',
  )
  assert(
    doctorHelpOut.toLowerCase().includes('exit'),
    'tsx doctor --help must mention exit code behavior',
  )

  const doctorTsx = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'doctor'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  assert(doctorTsx.error === undefined, String(doctorTsx.error))
  assert(
    doctorTsx.status === 0,
    `tsx doctor failed: status=${doctorTsx.status} stderr=${doctorTsx.stderr}`,
  )
  assertDoctorOutputContract(
    `${doctorTsx.stdout}\n${doctorTsx.stderr}`,
    'tsx doctor',
    false,
  )

  const doctorFailTmp = mkdtempSync(join(tmpdir(), 'md-doctor-fail-'))
  const pathBlockedByFile = join(doctorFailTmp, 'not-a-dir')
  writeFileSync(pathBlockedByFile, 'block\n', 'utf8')
  const badMessagesPath = join(pathBlockedByFile, 'messages.json')
  const doctorTsxFail = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'doctor'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_DATA_PATH: badMessagesPath,
      },
    },
  )
  assert(doctorTsxFail.error === undefined, String(doctorTsxFail.error))
  assert(
    doctorTsxFail.status === 1,
    `tsx doctor with messages parent as file expected exit 1, got ${doctorTsxFail.status} stderr=${doctorTsxFail.stderr}`,
  )
  assertDoctorOutputContract(
    `${doctorTsxFail.stdout}\n${doctorTsxFail.stderr}`,
    'tsx doctor (forced messages-path failure)',
    true,
  )

  const build = spawnSync(
    'pnpm',
    ['--dir', 'packages/cli', 'run', 'build'],
    { cwd: root, encoding: 'utf8' },
  )
  assert(build.error === undefined, String(build.error))
  assert(
    build.status === 0,
    `pnpm --dir packages/cli run build failed: status=${build.status} stdout=${build.stdout} stderr=${build.stderr}`,
  )

  const helpDist = spawnSync('node', [distEntry, '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert(helpDist.error === undefined, String(helpDist.error))
  assert(
    helpDist.status === 0,
    `node dist/index.js --help failed: status=${helpDist.status} stderr=${helpDist.stderr}`,
  )
  assertHelpListsCommands(
    `${helpDist.stdout}\n${helpDist.stderr}`,
    'node dist/index.js --help',
  )

  const startHelpDist = spawnSync('node', [distEntry, 'start', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert(startHelpDist.error === undefined, String(startHelpDist.error))
  assert(
    startHelpDist.status === 0,
    `node dist start --help failed: status=${startHelpDist.status} stderr=${startHelpDist.stderr}`,
  )
  const startHelpDistOut = `${startHelpDist.stdout}\n${startHelpDist.stderr}`
  for (const flag of START_HELP_FLAGS) {
    assert(
      startHelpDistOut.includes(flag),
      `node dist start --help must mention "${flag}"`,
    )
  }

  const doctorDist = spawnSync('node', [distEntry, 'doctor'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert(doctorDist.error === undefined, String(doctorDist.error))
  assert(
    doctorDist.status === 0,
    `node dist doctor failed: status=${doctorDist.status} stderr=${doctorDist.stderr}`,
  )
  assertDoctorOutputContract(
    `${doctorDist.stdout}\n${doctorDist.stderr}`,
    'node dist doctor',
    false,
  )

  await verifyStartCommandReachesServer(root, 'tsx CLI start', 'pnpm', [
    'exec',
    'tsx',
    cliEntry,
  ])

  await verifyStartCommandReachesServer(root, 'node dist start', 'node', [
    distEntry,
  ])

  await verifyStartFromSimulatedGlobalInstall(root)

  const autostartHelpTsx = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', '--help'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  assert(autostartHelpTsx.error === undefined, String(autostartHelpTsx.error))
  assert(
    autostartHelpTsx.status === 0,
    `tsx autostart --help failed: status=${autostartHelpTsx.status} stderr=${autostartHelpTsx.stderr}`,
  )
  const autostartHelpOut = `${autostartHelpTsx.stdout}\n${autostartHelpTsx.stderr}`
  for (const sub of ['enable', 'disable', 'status'] as const) {
    assert(
      autostartHelpOut.includes(sub),
      `tsx autostart --help must mention subcommand "${sub}"`,
    )
  }

  const unsupportedStatus = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'status'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'unsupported',
      },
    },
  )
  assert(unsupportedStatus.error === undefined, String(unsupportedStatus.error))
  assert(
    unsupportedStatus.status === 1,
    `autostart status (forced unsupported) expected exit 1, got ${unsupportedStatus.status}`,
  )
  const unsupportedOut = `${unsupportedStatus.stdout}\n${unsupportedStatus.stderr}`
  assert(
    unsupportedOut.includes('Autostart is not supported on this platform or environment.'),
    'forced unsupported status must print deterministic header line',
  )
  assert(
    unsupportedOut.includes(
      '(MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER=unsupported)',
    ),
    'forced unsupported status must mention force env marker',
  )

  const unsupportedEnable = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'enable'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'unsupported',
      },
    },
  )
  assert(unsupportedEnable.error === undefined, String(unsupportedEnable.error))
  assert(
    unsupportedEnable.status === 1,
    `autostart enable (forced unsupported) expected exit 1, got ${unsupportedEnable.status}`,
  )
  const unsupportedEnableOut = `${unsupportedEnable.stdout}\n${unsupportedEnable.stderr}`
  assert(
    unsupportedEnableOut.includes(
      'autostart enable: not supported on this platform or environment.',
    ),
    'forced unsupported enable must print deterministic first line',
  )
  assert(
    unsupportedEnableOut.includes(
      '(MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER=unsupported)',
    ),
    'forced unsupported enable must mention force env marker',
  )

  const unsupportedDisable = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'disable'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'unsupported',
      },
    },
  )
  assert(
    unsupportedDisable.error === undefined,
    String(unsupportedDisable.error),
  )
  assert(
    unsupportedDisable.status === 1,
    `autostart disable (forced unsupported) expected exit 1, got ${unsupportedDisable.status}`,
  )
  const unsupportedDisableOut = `${unsupportedDisable.stdout}\n${unsupportedDisable.stderr}`
  assert(
    unsupportedDisableOut.includes(
      'autostart disable: not supported on this platform or environment.',
    ),
    'forced unsupported disable must print deterministic first line',
  )
  assert(
    unsupportedDisableOut.includes(
      '(MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER=unsupported)',
    ),
    'forced unsupported disable must mention force env marker',
  )

  const winStartupDir = mkdtempSync(join(tmpdir(), 'md-fake-startup-'))
  const winForcedStatus = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'status'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'windows-startup',
        MESSAGE_DROP_WINDOWS_STARTUP_DIR: winStartupDir,
      },
    },
  )
  assert(winForcedStatus.error === undefined, String(winForcedStatus.error))
  assert(
    winForcedStatus.status === 0,
    `autostart status (forced windows + empty startup dir) expected exit 0, got ${winForcedStatus.status} stderr=${winForcedStatus.stderr}`,
  )
  const winOut = `${winForcedStatus.stdout}\n${winForcedStatus.stderr}`
  assert(
    winOut.includes('autostart is disabled'),
    'forced windows provider must report disabled startup state',
  )

  const winEnable = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'enable'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'windows-startup',
        MESSAGE_DROP_WINDOWS_STARTUP_DIR: winStartupDir,
      },
    },
  )
  assert(winEnable.error === undefined, String(winEnable.error))
  assert(
    winEnable.status === 0,
    `autostart enable (forced windows) expected exit 0, got ${winEnable.status} stderr=${winEnable.stderr}`,
  )
  const winEnableOut = `${winEnable.stdout}\n${winEnable.stderr}`
  assert(
    winEnableOut.includes('wrote startup marker'),
    'forced windows enable must report writing marker',
  )

  const winAfterEnableStatus = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'status'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'windows-startup',
        MESSAGE_DROP_WINDOWS_STARTUP_DIR: winStartupDir,
      },
    },
  )
  assert(
    winAfterEnableStatus.error === undefined,
    String(winAfterEnableStatus.error),
  )
  assert(
    winAfterEnableStatus.status === 0,
    `autostart status after windows enable expected exit 0, got ${winAfterEnableStatus.status}`,
  )
  const winAfterEnableOut = `${winAfterEnableStatus.stdout}\n${winAfterEnableStatus.stderr}`
  assert(
    winAfterEnableOut.includes('autostart is enabled'),
    'after enable, windows status must report enabled',
  )

  const winDisable = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'disable'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'windows-startup',
        MESSAGE_DROP_WINDOWS_STARTUP_DIR: winStartupDir,
      },
    },
  )
  assert(winDisable.error === undefined, String(winDisable.error))
  assert(
    winDisable.status === 0,
    `autostart disable (forced windows) expected exit 0, got ${winDisable.status} stderr=${winDisable.stderr}`,
  )
  const winDisableOut = `${winDisable.stdout}\n${winDisable.stderr}`
  assert(
    winDisableOut.includes('removed startup marker'),
    'forced windows disable must report removing marker',
  )

  const winAfterDisableStatus = spawnSync(
    'pnpm',
    ['exec', 'tsx', cliEntry, 'autostart', 'status'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'windows-startup',
        MESSAGE_DROP_WINDOWS_STARTUP_DIR: winStartupDir,
      },
    },
  )
  assert(
    winAfterDisableStatus.error === undefined,
    String(winAfterDisableStatus.error),
  )
  assert(
    winAfterDisableStatus.status === 0,
    `autostart status after windows disable expected exit 0, got ${winAfterDisableStatus.status}`,
  )
  const winAfterDisableOut = `${winAfterDisableStatus.stdout}\n${winAfterDisableStatus.stderr}`
  assert(
    winAfterDisableOut.includes('autostart is disabled'),
    'after disable, windows status must report disabled',
  )

  if (process.platform !== 'win32') {
    const fakeDir = mkdtempSync(join(tmpdir(), 'md-fake-systemctl-'))
    const fakeHome = join(fakeDir, 'home')
    const stateFile = join(fakeDir, 'unit-state')
    const fakeSystemctlPath = join(fakeDir, 'fake-systemctl.cjs')
    const fakeSrc = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
let i = 0
if (args[i] === '--user') {
  i++
}
const SERVICE = 'message-drop-autostart.service'
const statePath = process.env.MESSAGE_DROP_FAKE_SYSTEMCTL_STATE_FILE || ''

function readState() {
  if (!statePath || !fs.existsSync(statePath)) {
    return 'missing'
  }
  return fs.readFileSync(statePath, 'utf8').trim()
}

function writeState(value) {
  if (!statePath) return
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, value + '\\n', 'utf8')
}

if (args[i] === 'is-enabled' && args[i + 1] === SERVICE) {
  const s = readState()
  if (s === 'missing' || s === '') {
    process.stdout.write('not-found\\n')
    process.exit(1)
  }
  if (s === 'enabled') {
    process.stdout.write('enabled\\n')
    process.exit(0)
  }
  process.stdout.write('disabled\\n')
  process.exit(1)
}
if (args[i] === 'daemon-reload') {
  process.exit(0)
}
if (args[i] === 'enable' && args[i + 1] === SERVICE) {
  writeState('enabled')
  process.exit(0)
}
if (args[i] === 'disable' && args[i + 1] === SERVICE) {
  const s = readState()
  if (s === 'enabled' || s === 'disabled') {
    writeState('disabled')
  }
  process.exit(0)
}
process.stderr.write('fake-systemctl: unhandled ' + JSON.stringify(args) + '\\n')
process.exit(2)
`
    writeFileSync(fakeSystemctlPath, fakeSrc, 'utf8')
    chmodSync(fakeSystemctlPath, 0o755)

    const linuxEnv = {
      ...process.env,
      MESSAGE_DROP_AUTOSTART_FORCE_PROVIDER: 'linux-systemd',
      MESSAGE_DROP_SYSTEMCTL_PATH: fakeSystemctlPath,
      MESSAGE_DROP_FAKE_SYSTEMCTL_STATE_FILE: stateFile,
      MESSAGE_DROP_AUTOSTART_HOME: fakeHome,
      MESSAGE_DROP_AUTOSTART_BIN: '/bin/true',
    }

    const linuxForcedStatus = spawnSync(
      'pnpm',
      ['exec', 'tsx', cliEntry, 'autostart', 'status'],
      {
        cwd: root,
        encoding: 'utf8',
        env: linuxEnv,
      },
    )
    assert(
      linuxForcedStatus.error === undefined,
      String(linuxForcedStatus.error),
    )
    assert(
      linuxForcedStatus.status === 0,
      `autostart status (forced linux + fake systemctl) expected exit 0, got ${linuxForcedStatus.status} stderr=${linuxForcedStatus.stderr}`,
    )
    const linuxOut = `${linuxForcedStatus.stdout}\n${linuxForcedStatus.stderr}`
    assert(
      linuxOut.includes('is not installed.'),
      'fake systemctl not-found must map to not-installed status text',
    )

    const linuxEnable = spawnSync(
      'pnpm',
      ['exec', 'tsx', cliEntry, 'autostart', 'enable'],
      {
        cwd: root,
        encoding: 'utf8',
        env: linuxEnv,
      },
    )
    assert(linuxEnable.error === undefined, String(linuxEnable.error))
    assert(
      linuxEnable.status === 0,
      `autostart enable (forced linux + fake systemctl) expected exit 0, got ${linuxEnable.status} stderr=${linuxEnable.stderr}`,
    )

    const linuxAfterEnableStatus = spawnSync(
      'pnpm',
      ['exec', 'tsx', cliEntry, 'autostart', 'status'],
      {
        cwd: root,
        encoding: 'utf8',
        env: linuxEnv,
      },
    )
    assert(
      linuxAfterEnableStatus.error === undefined,
      String(linuxAfterEnableStatus.error),
    )
    assert(
      linuxAfterEnableStatus.status === 0,
      `autostart status after linux enable expected exit 0, got ${linuxAfterEnableStatus.status}`,
    )
    const linuxAfterEnableOut = `${linuxAfterEnableStatus.stdout}\n${linuxAfterEnableStatus.stderr}`
    assert(
      linuxAfterEnableOut.includes('is enabled'),
      'after enable, linux status must report enabled',
    )

    const linuxDisable = spawnSync(
      'pnpm',
      ['exec', 'tsx', cliEntry, 'autostart', 'disable'],
      {
        cwd: root,
        encoding: 'utf8',
        env: linuxEnv,
      },
    )
    assert(linuxDisable.error === undefined, String(linuxDisable.error))
    assert(
      linuxDisable.status === 0,
      `autostart disable (forced linux + fake systemctl) expected exit 0, got ${linuxDisable.status} stderr=${linuxDisable.stderr}`,
    )

    const linuxAfterDisableStatus = spawnSync(
      'pnpm',
      ['exec', 'tsx', cliEntry, 'autostart', 'status'],
      {
        cwd: root,
        encoding: 'utf8',
        env: linuxEnv,
      },
    )
    assert(
      linuxAfterDisableStatus.error === undefined,
      String(linuxAfterDisableStatus.error),
    )
    assert(
      linuxAfterDisableStatus.status === 0,
      `autostart status after linux disable expected exit 0, got ${linuxAfterDisableStatus.status}`,
    )
    const linuxAfterDisableOut = `${linuxAfterDisableStatus.stdout}\n${linuxAfterDisableStatus.stderr}`
    assert(
      linuxAfterDisableOut.includes('present but not enabled'),
      'after disable, linux status must report unit present but not enabled',
    )
  }

  console.log('Phase 7 CLI verification: OK')
}

void mainAsync()
  .then(() => {
    process.exit(0)
  })
  .catch((e: unknown) => {
    if (e instanceof Error) {
      console.error(e.message)
    } else {
      console.error(String(e))
    }
    process.exit(1)
  })
