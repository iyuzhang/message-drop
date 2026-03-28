import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')} (exit=${result.status})`,
    )
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')
const repoRoot = resolve(packageRoot, '..', '..')
const webRoot = join(repoRoot, 'web')
const webDist = join(webRoot, 'dist')
const runtimeRoot = join(packageRoot, 'dist', 'runtime')
const runtimeWebDist = join(runtimeRoot, 'web', 'dist')

run('pnpm', ['--dir', webRoot, 'run', 'build'], repoRoot)
run(
  'pnpm',
  ['exec', 'tsc', '-p', join(packageRoot, 'tsconfig.runtime.json')],
  packageRoot,
)

if (!existsSync(webDist)) {
  throw new Error(`Missing web build output: ${webDist}`)
}

rmSync(runtimeWebDist, { recursive: true, force: true })
mkdirSync(runtimeWebDist, { recursive: true })
cpSync(webDist, runtimeWebDist, { recursive: true })
