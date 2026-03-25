/**
 * Verifies release tag parsing, semver comparison, GitHub payload parsing,
 * cache TTL defaults, and bounded retry behavior for the web release checker.
 */
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type SemverTuple = [number, number, number]

/** Describes exports from web/src/release.ts used by this verifier (dynamic load). */
interface ReleaseVerifyModule {
  DEFAULT_RELEASE_CACHE_TTL_MS: number
  MAX_RELEASE_FETCH_ATTEMPTS: number
  compareSemverTuples: (a: SemverTuple, b: SemverTuple) => number
  fetchLatestReleaseWithRetry: (
    owner: string,
    repo: string,
    signal?: AbortSignal,
  ) => Promise<{ tagName: string; htmlUrl: string } | null>
  parseGithubReleasePayload: (
    data: unknown,
  ) => { tagName: string; htmlUrl: string } | null
  parseTagVersion: (input: string) => SemverTuple | null
  resolveReleaseCacheTtlMs: () => number
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

/** Loads web release helpers at runtime so root `tsc` does not typecheck browser-only modules. */
async function loadReleaseVerifyModule(): Promise<ReleaseVerifyModule> {
  const href: string = pathToFileURL(
    join(repoRoot(), 'web/src/release.ts'),
  ).href
  const mod: unknown = await import(href)
  return mod as ReleaseVerifyModule
}

function assertFileExists(rel: string, label: string): void {
  assert(existsSync(join(repoRoot(), rel)), `${label}: missing ${rel}`)
}

void (async function main(): Promise<void> {
  const {
    DEFAULT_RELEASE_CACHE_TTL_MS,
    MAX_RELEASE_FETCH_ATTEMPTS,
    compareSemverTuples,
    fetchLatestReleaseWithRetry,
    parseGithubReleasePayload,
    parseTagVersion,
    resolveReleaseCacheTtlMs,
  } = await loadReleaseVerifyModule()

  assertFileExists('web/src/release.ts', 'phase8')
  assertFileExists('web/src/api.ts', 'phase8')
  assertFileExists('web/src/App.tsx', 'phase8')
  assertFileExists('web/src/types.ts', 'phase8')
  assertFileExists(
    'android/app/src/main/java/com/messagedrop/android/MainActivity.kt',
    'phase8',
  )

  assert.deepStrictEqual(parseTagVersion('v1.2.3'), [1, 2, 3])
  assert.deepStrictEqual(parseTagVersion('  2.0  '), [2, 0, 0])
  assert.deepStrictEqual(parseTagVersion('0.1'), [0, 1, 0])
  assert.strictEqual(parseTagVersion(''), null)
  assert.strictEqual(parseTagVersion('x.y.z'), null)

  const a = parseTagVersion('1.0.0')!
  const b = parseTagVersion('1.0.1')!
  assert.strictEqual(compareSemverTuples(a, b), -1)
  assert.strictEqual(compareSemverTuples(b, a), 1)
  assert.strictEqual(compareSemverTuples(a, a), 0)

  assert.strictEqual(
    parseGithubReleasePayload({
      tag_name: 'v1.0.0',
      html_url: 'https://github.com/o/r/releases/tag/v1.0.0',
    })?.tagName,
    'v1.0.0',
  )
  assert.strictEqual(parseGithubReleasePayload(null), null)
  assert.strictEqual(parseGithubReleasePayload({}), null)
  assert.strictEqual(
    parseGithubReleasePayload({
      tag_name: 'v1',
      html_url: 'not-a-url',
    }),
    null,
  )

  assert.strictEqual(resolveReleaseCacheTtlMs(), DEFAULT_RELEASE_CACHE_TTL_MS)

  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (calls < 3) {
      return new Response('', { status: 503 })
    }
    return new Response(
      JSON.stringify({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/example/repo/releases/tag/v9.9.9',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  try {
    const got = await fetchLatestReleaseWithRetry('example', 'repo')
    assert.strictEqual(calls, 3)
    assert.strictEqual(got?.tagName, 'v9.9.9')
    assert.ok(got?.htmlUrl.startsWith('https://'))
  } finally {
    globalThis.fetch = originalFetch
  }

  let failCalls = 0
  globalThis.fetch = (async () => {
    failCalls += 1
    return new Response('', { status: 500 })
  }) as typeof fetch

  try {
    const got = await fetchLatestReleaseWithRetry('example', 'repo')
    assert.strictEqual(failCalls, MAX_RELEASE_FETCH_ATTEMPTS)
    assert.strictEqual(got, null)
  } finally {
    globalThis.fetch = originalFetch
  }

  const kt = await import('node:fs/promises').then((fs) =>
    fs.readFile(
      join(
        repoRoot(),
        'android/app/src/main/java/com/messagedrop/android/MainActivity.kt',
      ),
      'utf8',
    ),
  )
  assert.ok(
    kt.includes('MessageDropAndroid'),
    'MainActivity must register MessageDropAndroid bridge',
  )
  assert.ok(
    kt.includes('getAppVersion'),
    'MainActivity must expose getAppVersion to the WebView',
  )

  console.log('[verify-phase8-release-check] ok')
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
