import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cwd } from 'node:process'

const here = cwd()
const source = resolve(here, '../../web/dist')
const destination = resolve(here, 'dist-resources/web/dist')

if (!existsSync(source)) {
  throw new Error(`Web build output not found: ${source}`)
}

mkdirSync(join(here, 'dist-resources', 'web'), { recursive: true })
rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, { recursive: true })
