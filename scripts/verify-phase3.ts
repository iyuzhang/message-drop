/**
 * Phase 3: two simultaneous WebSocket clients receive the same append
 * (simulates two PC browser tabs / two dev-server ports talking to one pool).
 */
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
  const dir = await mkdtemp(join(tmpdir(), 'message-drop-p3-'))
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

  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    throw new Error('expected TCP address')
  }
  const port = addr.port
  const base = `http://127.0.0.1:${port}`
  const wsUrl = `ws://127.0.0.1:${port}/ws`

  const a: string[] = []
  const b: string[] = []
  const wsA = new WebSocket(wsUrl)
  const wsB = new WebSocket(wsUrl)
  wsA.on('message', (d) => a.push(String(d)))
  wsB.on('message', (d) => b.push(String(d)))

  await onceOpen(wsA)
  await onceOpen(wsB)

  await drainOne(a)
  await drainOne(b)

  const post = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'text', content: 'multi-client' }),
  })
  if (post.status !== 201) throw new Error(`post: ${post.status}`)

  const ra = await drainOne(a)
  const rb = await drainOne(b)
  const ja = JSON.parse(ra) as { type?: string; message?: { content?: string } }
  const jb = JSON.parse(rb) as { type?: string; message?: { content?: string } }
  if (ja.type !== 'append' || ja.message?.content !== 'multi-client') {
    throw new Error(`client A bad: ${ra}`)
  }
  if (jb.type !== 'append' || jb.message?.content !== 'multi-client') {
    throw new Error(`client B bad: ${rb}`)
  }

  wsA.close()
  wsB.close()

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  await rm(dir, { recursive: true, force: true })

  console.log('Phase 3 verification: OK')
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

function drainOne(queue: string[]): Promise<string> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const n = queue.shift()
      if (n !== undefined) {
        resolve(n)
        return
      }
      if (Date.now() - start > 5000) {
        reject(new Error('ws message timeout'))
        return
      }
      setImmediate(tick)
    }
    tick()
  })
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
