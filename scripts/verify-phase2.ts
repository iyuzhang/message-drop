import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { createMessageApp } from '../src/app.js'
import { toClientMessage } from '../src/sanitize.js'
import { MessageStore } from '../src/store.js'
import type { PoolMessage } from '../src/types.js'

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'message-drop-p2-'))
  const dataPath = join(dir, 'messages.json')
  const store = new MessageStore(dataPath)

  let pushNewMessage: (msg: PoolMessage) => void = () => {}
  const clients = new Set<WebSocket>()

  function wsBroadcast(payload: unknown): void {
    const data = JSON.stringify(payload)
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }

  const app = createMessageApp(store, {
    onMessageCreated: (msg) => pushNewMessage(msg),
  })

  const server = serve({ fetch: app.fetch, port: 0 })

  const wss = new WebSocketServer({ server: server as Server, path: '/ws' })
  wss.on('connection', (ws) => {
    clients.add(ws)
    void store.list().then((messages) => {
      const publicMessages = messages.map(toClientMessage)
      ws.send(JSON.stringify({ type: 'snapshot', messages: publicMessages }))
    })
  })

  pushNewMessage = (msg) => {
    wsBroadcast({ type: 'append', message: toClientMessage(msg) })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })

  try {
    await run(server, portOf(server))
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    await rm(dir, { recursive: true, force: true })
  }

  if (process.exitCode === 1) process.exit(1)
  console.log('Phase 2 verification: OK')
}

function portOf(server: ReturnType<typeof serve>): number {
  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    throw new Error('expected TCP address')
  }
  return addr.port
}

async function run(
  server: ReturnType<typeof serve>,
  port: number,
): Promise<void> {
  void server
  const base = `http://127.0.0.1:${port}`
  const wsUrl = `ws://127.0.0.1:${port}/ws`

  const ws = new WebSocket(wsUrl)
  const inbox: string[] = []
  ws.on('message', (data) => {
    inbox.push(String(data))
  })
  await onceOpen(ws)

  const snapRaw = await drainUntil(inbox, 3000)
  const snap = JSON.parse(snapRaw) as { type?: string; messages?: unknown[] }
  if (snap.type !== 'snapshot' || !Array.isArray(snap.messages)) {
    throw new Error('expected snapshot')
  }
  if (snap.messages.length !== 0) throw new Error('snapshot not empty')

  const post = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'text', content: 'ws-phase2' }),
  })
  if (post.status !== 201) throw new Error(`post: ${post.status}`)

  const appendRaw = await drainUntil(inbox, 3000)
  const append = JSON.parse(appendRaw) as {
    type?: string
    message?: { content?: string }
  }
  if (append.type !== 'append' || append.message?.content !== 'ws-phase2') {
    throw new Error(`expected append, got ${appendRaw}`)
  }

  ws.close()
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws open timeout')), 5000)
    ws.once('open', () => {
      clearTimeout(t)
      resolve()
    })
    ws.once('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

function drainUntil(queue: string[], ms: number): Promise<string> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const next = queue.shift()
      if (next !== undefined) {
        resolve(next)
        return
      }
      if (Date.now() - start > ms) {
        reject(new Error('ws message timeout'))
        return
      }
      setImmediate(tick)
    }
    tick()
  })
}

void main()
