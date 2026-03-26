import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const cd = dl0.headers.get('Content-Disposition') ?? ''
  if (!cd.includes('filename=')) throw new Error('missing download filename header')
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

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const appCssPath = join(repoRoot, 'web/src/App.css')
  const appCss = await readFile(appCssPath, 'utf8')
  const uiMarkers = [
    '--touch-target-min',
    '--app-bottom-inset',
    '.composer-toolbar',
    '.update-banner',
  ]
  for (const marker of uiMarkers) {
    if (!appCss.includes(marker)) {
      throw new Error(`App.css missing mobile UI baseline marker: ${marker}`)
    }
  }

  const messagePoolPath = join(repoRoot, 'web/src/useMessagePool.ts')
  const messagePoolSource = await readFile(messagePoolPath, 'utf8')
  if (!messagePoolSource.includes('a.timestamp - b.timestamp')) {
    throw new Error('Message list sort order is not oldest-first')
  }

  const mainActivityPath = join(
    repoRoot,
    'android/app/src/main/java/com/messagedrop/android/MainActivity.kt',
  )
  const mainActivitySource = await readFile(mainActivityPath, 'utf8')
  const androidInsetsMarkers = [
    'WindowCompat.setDecorFitsSystemWindows(window, false)',
    'ViewCompat.setOnApplyWindowInsetsListener',
    'webView.setDownloadListener',
    'DownloadManager.Request',
    'enqueueDownload(',
    'onReceivedError',
    'failingUrl',
    'scheduleDiscoveryRetry',
    'Trying to reconnect',
  ]
  for (const marker of androidInsetsMarkers) {
    if (!mainActivitySource.includes(marker)) {
      throw new Error(`MainActivity missing Android inset handling marker: ${marker}`)
    }
  }

  const appTsxPath = join(repoRoot, 'web/src/App.tsx')
  const appTsxSource = await readFile(appTsxPath, 'utf8')
  const downloadMarkers = [
    'const isAndroidWebView',
    "target={isAndroidWebView ? undefined : '_blank'}",
  ]
  for (const marker of downloadMarkers) {
    if (!appTsxSource.includes(marker)) {
      throw new Error(`App.tsx missing Android download marker: ${marker}`)
    }
  }

  console.log('Phase 4 verification: OK')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
