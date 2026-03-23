/**
 * Phase 5: UDP discovery beacon received + /debug page + best-effort mDNS browse.
 */
import { createSocket } from 'node:dgram'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Bonjour, type Service } from 'bonjour-service'
import { createMessageApp } from '../src/app.js'
import { startLanDiscovery } from '../src/discovery.js'
import { FileStore } from '../src/file-store.js'
import { toClientMessage } from '../src/sanitize.js'
import { MessageStore } from '../src/store.js'
import type { PoolMessage } from '../src/types.js'
import { WebSocket, WebSocketServer } from 'ws'

async function main(): Promise<void> {
  const udpPort = 47_811 + Math.floor(Math.random() * 100)
  process.env.MESSAGE_DROP_DISCOVERY_UDP_PORT = String(udpPort)

  const dir = await mkdtemp(join(tmpdir(), 'message-drop-p5-'))
  const dataPath = join(dir, 'messages.json')
  const filesPath = join(dir, 'files')
  const store = new MessageStore(dataPath)
  const fileStore = new FileStore(filesPath)

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
    fileStore,
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
  if (addr === null || typeof addr === 'string') throw new Error('addr')
  const httpPort = addr.port

  const recv = createSocket('udp4')
  const beaconPromise = new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('udp beacon timeout')), 8000)
    recv.on('message', (buf) => {
      clearTimeout(t)
      resolve(String(buf))
    })
    recv.once('error', reject)
  })

  await new Promise<void>((resolve, reject) => {
    recv.once('error', reject)
    recv.bind(udpPort, () => resolve())
  })

  const disc = startLanDiscovery(httpPort)
  const beacon = await beaconPromise
  recv.close()

  const parsed = JSON.parse(beacon) as {
    svc?: string
    http?: number
    wsPath?: string
  }
  if (parsed.svc !== 'message-drop' || parsed.http !== httpPort) {
    throw new Error(`bad beacon: ${beacon}`)
  }
  if (parsed.wsPath !== '/ws') throw new Error('bad ws path in beacon')

  const dbg = await fetch(`http://127.0.0.1:${httpPort}/debug`)
  if (!dbg.ok) throw new Error(`debug: ${dbg.status}`)
  const html = await dbg.text()
  if (!html.includes('websocketClients')) throw new Error('debug page shape')

  await new Promise<void>((resolve) => {
    const b = new Bonjour()
    b.findOne({ type: 'message-drop' }, 2500, (svc: Service | null) => {
      if (svc && svc.port === httpPort) {
        console.log('[verify-phase5] mDNS observed local service')
      } else {
        console.log(
          '[verify-phase5] mDNS browse inconclusive (ok on some hosts)',
        )
      }
      b.destroy(() => resolve())
    })
  })

  disc.stop()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  await rm(dir, { recursive: true, force: true })

  console.log('Phase 5 verification: OK')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
