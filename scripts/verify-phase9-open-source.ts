/**
 * Checks presence and minimal content of open-source documentation (root README, LICENSE,
 * CONTRIBUTING, SECURITY), GitHub issue/PR template files, the CLI package README and LICENSE,
 * and basic .gitignore hygiene. Does not validate the rest of `.github/` or other governance files.
 */
import { strict as assert } from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..')
}

function readUtf8(rel: string): string {
  return readFileSync(join(repoRoot(), rel), 'utf8')
}

function assertFileExists(rel: string, label: string): void {
  assert(existsSync(join(repoRoot(), rel)), `${label}: missing ${rel}`)
}

function assertReadmeCoversBasics(text: string): void {
  const lower = text.toLowerCase()
  assert.ok(lower.includes('message-drop'), 'README must mention message-drop')
  assert.ok(
    lower.includes('architecture') || lower.includes('platform'),
    'README must describe architecture or platforms',
  )
  assert.ok(
    lower.includes('quick start') || lower.includes('quickstart'),
    'README must include a quick start section',
  )
  assert.ok(
    lower.includes('global') && lower.includes('install'),
    'README must mention global install',
  )
  assert.ok(
    lower.includes('github') && lower.includes('release'),
    'README must mention GitHub releases (Android)',
  )
  assert.ok(
    lower.includes('troubleshoot'),
    'README must include troubleshooting',
  )
  assert.ok(
    lower.includes('lan') || lower.includes('local network'),
    'README must mention LAN or local network discoverability',
  )
}

function assertYamlIssueTemplate(text: string, name: string): void {
  assert.ok(text.includes('name:'), `${name} must declare name`)
  assert.ok(text.includes('body:'), `${name} must declare body`)
}

function assertLicenseBasics(text: string, label: string): void {
  assert.ok(
    text.length >= 80,
    `${label}: license text should be substantial`,
  )
  assert.ok(
    /isc|copyright/i.test(text),
    `${label}: should identify ISC or copyright`,
  )
}

function assertCliReadmeBasics(text: string): void {
  const lower = text.toLowerCase()
  assert.ok(
    lower.includes('message-drop'),
    'packages/cli/README.md must mention message-drop',
  )
  assert.ok(
    lower.includes('cli') || lower.includes('command-line'),
    'packages/cli/README.md must describe the CLI',
  )
  assert.ok(
    text.trim().length >= 40,
    'packages/cli/README.md should have a short substantive blurb',
  )
}

void (function main(): void {
  const root = repoRoot()

  assertFileExists('README.md', 'phase9')
  assertFileExists('LICENSE', 'phase9')
  assertFileExists('CONTRIBUTING.md', 'phase9')
  assertFileExists('SECURITY.md', 'phase9')
  assertFileExists('.github/ISSUE_TEMPLATE/bug_report.yml', 'phase9')
  assertFileExists('.github/ISSUE_TEMPLATE/feature_request.yml', 'phase9')
  assertFileExists('.github/PULL_REQUEST_TEMPLATE.md', 'phase9')

  const readme = readUtf8('README.md')
  assertReadmeCoversBasics(readme)

  const license = readUtf8('LICENSE')
  assertLicenseBasics(license, 'root LICENSE')

  assertFileExists('packages/cli/README.md', 'phase9-cli-readme')
  assertFileExists('packages/cli/LICENSE', 'phase9-cli-license')
  const cliReadme = readUtf8('packages/cli/README.md')
  assertCliReadmeBasics(cliReadme)
  const cliLicense = readUtf8('packages/cli/LICENSE')
  assertLicenseBasics(cliLicense, 'packages/cli/LICENSE')

  const contributing = readUtf8('CONTRIBUTING.md')
  assert.ok(
    /verify:all|contribut/i.test(contributing),
    'CONTRIBUTING should mention verify:all or contribution flow',
  )

  const security = readUtf8('SECURITY.md')
  assert.ok(
    /vulnerabilit|security|report/i.test(security),
    'SECURITY should describe reporting',
  )

  const bugYml = readUtf8('.github/ISSUE_TEMPLATE/bug_report.yml')
  const featYml = readUtf8('.github/ISSUE_TEMPLATE/feature_request.yml')
  assertYamlIssueTemplate(bugYml, 'bug_report.yml')
  assertYamlIssueTemplate(featYml, 'feature_request.yml')

  const prTemplate = readUtf8('.github/PULL_REQUEST_TEMPLATE.md')
  assert.ok(
    prTemplate.includes('Summary') || prTemplate.includes('summary'),
    'PR template should prompt for a summary',
  )

  const gitignorePath = join(root, '.gitignore')
  assert.ok(existsSync(gitignorePath), 'phase9: .gitignore must exist')
  const gitignore = readUtf8('.gitignore')
  assert.ok(
    gitignore.includes('node_modules'),
    '.gitignore should ignore node_modules',
  )

  console.log('[verify-phase9-open-source] ok')
})()
