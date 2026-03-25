/**
 * Runs install/start environment diagnostics for the doctor command.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveEffectiveServerDataPaths } from '../utils/paths.js'

const MIN_NODE_MAJOR = 18

function printDoctorHelp(): void {
  console.log(`Usage: message-drop doctor

Runs quick checks for install/start issues (Node.js, MESSAGE_DROP_DATA_PATH /
MESSAGE_DROP_FILES_DIR writability, port hints). Exits with code 1 if any
check fails. Warnings do not change the exit code.`)
}

function errnoCodeFromUnknown(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const raw = (e as { code: unknown }).code
    if (typeof raw === 'string' && raw !== '') {
      return raw
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw)
    }
  }
  return 'UNKNOWN'
}

function errorMessageFromUnknown(e: unknown): string {
  if (e instanceof Error && e.message !== '') {
    return e.message
  }
  return String(e)
}

function parseNodeMajor(version: string): number | undefined {
  const m = /^v(?<major>\d+)/.exec(version)
  const raw = m?.groups?.major
  if (raw === undefined) {
    return undefined
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

async function verifyDirectoryWritable(
  dir: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await mkdir(dir, { recursive: true })
    const probe = join(dir, `.message-drop-doctor-${randomUUID()}`)
    const handle = await open(probe, 'wx')
    await handle.close()
    await unlink(probe)
    return { ok: true }
  } catch (e: unknown) {
    const code = errnoCodeFromUnknown(e)
    const msg = errorMessageFromUnknown(e)
    return { ok: false, message: `${code}: ${msg}` }
  }
}

interface DoctorCounters {
  ok: number
  warn: number
  fail: number
}

export async function runDoctor(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printDoctorHelp()
    return
  }

  const counters: DoctorCounters = { ok: 0, warn: 0, fail: 0 }
  const hints: string[] = []

  console.log('message-drop doctor\n')

  const major = parseNodeMajor(process.version)
  if (major === undefined || major < MIN_NODE_MAJOR) {
    counters.fail++
    console.error(
      `doctor-check node: fail ${process.version} (need Node.js major >= ${MIN_NODE_MAJOR})`,
    )
    hints.push(
      `Install Node.js ${MIN_NODE_MAJOR}+ (current ${process.version}). See https://nodejs.org/`,
    )
  } else {
    counters.ok++
    console.log(
      `doctor-check node: ok ${process.version} (minimum major ${MIN_NODE_MAJOR})`,
    )
  }

  const paths = resolveEffectiveServerDataPaths()

  for (const note of paths.configNotes) {
    console.log(`doctor-check config: note ${note}`)
  }

  if (paths.unconfigured) {
    counters.warn++
    console.log(
      'doctor-check messages: warn unresolved (set MESSAGE_DROP_DATA_PATH or run from a checkout)',
    )
    console.log(
      'doctor-check files: warn unresolved (set MESSAGE_DROP_FILES_DIR or run from a checkout)',
    )
    hints.push(
      'Set MESSAGE_DROP_DATA_PATH (messages.json) and MESSAGE_DROP_FILES_DIR (uploads), or run from a full message-drop checkout.',
    )
  } else {
    if (paths.messagesFile === '') {
      counters.warn++
      console.log(
        'doctor-check messages: warn unresolved (set MESSAGE_DROP_DATA_PATH)',
      )
      hints.push(
        'Set MESSAGE_DROP_DATA_PATH so the server knows where to store messages.json.',
      )
    } else {
      const messagesDir = dirname(paths.messagesFile)
      const messagesSrc = paths.messagesFromEnv ? 'env' : 'checkout-default'
      const writable = await verifyDirectoryWritable(messagesDir)
      if (writable.ok) {
        counters.ok++
        console.log(
          `doctor-check messages: ok ${paths.messagesFile} (${messagesSrc})`,
        )
      } else {
        counters.fail++
        console.error(`doctor-check messages: fail ${paths.messagesFile}`)
        console.error(`  parent directory: ${messagesDir}`)
        console.error(`  ${writable.message}`)
        hints.push(
          `Fix permissions on "${messagesDir}" or set MESSAGE_DROP_DATA_PATH / start --data-dir to a writable location.`,
        )
      }
    }

    if (paths.filesDir === '') {
      counters.warn++
      console.log(
        'doctor-check files: warn unresolved (set MESSAGE_DROP_FILES_DIR)',
      )
      hints.push(
        'Set MESSAGE_DROP_FILES_DIR so the server knows where to store uploads.',
      )
    } else {
      const filesSrc = paths.filesFromEnv ? 'env' : 'checkout-default'
      const writable = await verifyDirectoryWritable(paths.filesDir)
      if (writable.ok) {
        counters.ok++
        console.log(`doctor-check files: ok ${paths.filesDir} (${filesSrc})`)
      } else {
        counters.fail++
        console.error(`doctor-check files: fail ${paths.filesDir}`)
        console.error(`  ${writable.message}`)
        hints.push(
          `Fix permissions on "${paths.filesDir}" or set MESSAGE_DROP_FILES_DIR / start --data-dir appropriately.`,
        )
      }
    }
  }

  console.log(
    'doctor-check port: info default 8787 (override with PORT or message-drop start --port <n>)',
  )
  console.log(
    'doctor-check port: info if start fails with EADDRINUSE, another process owns the port; pick a free port.',
  )

  if (hints.length > 0) {
    console.log('\nNext steps:')
    for (const line of hints) {
      console.log(`- ${line}`)
    }
  }

  const exitCode = counters.fail > 0 ? 1 : 0
  console.log(
    `\ndoctor: summary ok=${counters.ok} warn=${counters.warn} fail=${counters.fail} exit=${exitCode}`,
  )
  process.exitCode = exitCode
}
