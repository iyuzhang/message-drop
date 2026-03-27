/**
 * Verifies GitHub Actions CI and release workflow files exist and contain the expected
 * verification and publish wiring (verify:all in CI, tagged npm publish in release).
 */
import { strict as assert } from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CI_REL = '.github/workflows/ci.yml'
const RELEASE_REL = '.github/workflows/release.yml'

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

function readUtf8(rel: string): string {
  return readFileSync(join(repoRoot(), rel), 'utf8')
}

function assertFileExists(rel: string, label: string): void {
  assert(existsSync(join(repoRoot(), rel)), `${label}: missing ${rel}`)
}

void (function main(): void {
  const root = repoRoot()
  assertFileExists('package.json', 'phase10')
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
  }
  const verifyAll = pkg.scripts?.['verify:all']
  assert.ok(
    typeof verifyAll === 'string' && verifyAll.length > 0,
    'package.json must define scripts.verify:all',
  )
  assert.ok(
    verifyAll.includes('verify:phase7-cli'),
    'verify:all must chain verify:phase7-cli',
  )
  assert.ok(
    verifyAll.includes('verify:phase8-release-check'),
    'verify:all must chain verify:phase8-release-check',
  )
  assert.ok(
    verifyAll.includes('verify:phase9-open-source'),
    'verify:all must chain verify:phase9-open-source',
  )
  assert.ok(
    verifyAll.includes('verify:phase10-release-workflow'),
    'verify:all must chain verify:phase10-release-workflow',
  )

  const adbSmoke = pkg.scripts?.['verify:adb-smoke']
  assert.ok(
    typeof adbSmoke === 'string' && adbSmoke.includes('verify-adb-smoke'),
    'package.json must define scripts.verify:adb-smoke targeting verify-adb-smoke',
  )
  assertFileExists('scripts/verify-adb-smoke.sh', 'phase10')

  assertFileExists(CI_REL, 'phase10')
  assertFileExists(RELEASE_REL, 'phase10')

  const ci = readUtf8(CI_REL)
  assert.ok(
    ci.includes('verify:all'),
    'ci.yml must run the full verify chain (verify:all)',
  )
  assert.ok(
    /pnpm\s+run\s+verify:all|pnpm\s+run\s+["']verify:all["']/.test(ci),
    'ci.yml must invoke pnpm run verify:all',
  )
  assert.ok(
    ci.includes('android-actions/setup-android'),
    'ci.yml must set up the Android SDK for phase 6 (Gradle)',
  )
  assert.ok(
    ci.includes('setup-java'),
    'ci.yml must set up Java for Android Gradle builds',
  )

  const release = readUtf8(RELEASE_REL)
  assert.ok(
    release.includes("'v*.*.*'") || release.includes('"v*.*.*"'),
    'release.yml must trigger on semver-like version tags (v*.*.*)',
  )
  assert.ok(
    release.includes('packages/cli'),
    'release.yml must build or publish from packages/cli',
  )
  assert.ok(
    /pnpm\s+(--dir\s+\S+\s+)?publish/.test(release) ||
      release.includes('pnpm publish --dir'),
    'release.yml must publish the CLI with pnpm publish',
  )
  assert.ok(
    release.includes('NODE_AUTH_TOKEN'),
    'release.yml must pass NODE_AUTH_TOKEN for npm authentication',
  )
  assert.ok(
    release.includes('NPM_TOKEN'),
    'release.yml must reference the NPM_TOKEN secret',
  )

  console.log('[verify-phase10-release-workflow] ok')
})()
