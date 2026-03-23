import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createMessageApp } from '../src/app.js'
import { FileStore } from '../src/file-store.js'
import { MessageStore } from '../src/store.js'

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'message-drop-p4-'))
  const dataPath = join(dir, 'messages.json')
  const filesPath = join(dir, 'files')

  const store = new MessageStore(dataPath)
  const fileStore = new FileStore(filesPath)
  const app = createMessageApp(store, { fileStore })

  const server = serve({ fetch: app.fetch, port: 0 })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('addr')
  const port = addr.port
  const base = `http://127.0.0.1:${port}`

  const payload = new Uint8Array([1, 2, 3, 4, 5])
  const blob = new Blob([payload], { type: 'application/octet-stream' })
  const fd = new FormData()
  fd.set('file', blob, 'blob.bin')

  const up = await fetch(`${base}/api/upload`, { method: 'POST', body: fd })
  if (up.status !== 200) throw new Error(`upload: ${up.status}`)
  const uj = (await up.json()) as { url?: string }
  if (!uj.url?.startsWith('/api/files/')) throw new Error('bad upload json')

  const dl0 = await fetch(`${base}${uj.url}`)
  if (!dl0.ok) throw new Error(`download: ${dl0.status}`)
  const buf = new Uint8Array(await dl0.arrayBuffer())
  if (buf.length !== payload.length) throw new Error('download size')

  const msg = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'file',
      content: 'blob.bin',
      file_url: uj.url,
    }),
  })
  if (msg.status !== 201) throw new Error(`message: ${msg.status}`)

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  await rm(dir, { recursive: true, force: true })

  console.log('Phase 4 verification: OK')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
