import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { createMessageApp } from './app.js'
import { startLanDiscovery, type DiscoveryHandle } from './discovery.js'
import { FileStore } from './file-store.js'
import { toClientMessage } from './sanitize.js'
import { telemetry } from './telemetry.js'
import { MessageStore } from './store.js'
import type { PoolMessage } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const port = Number(process.env.PORT ?? '8787')
const host = process.env.HOST ?? '0.0.0.0'
const dataPath =
  process.env.MESSAGE_DROP_DATA_PATH ??
  join(__dirname, '..', 'data', 'messages.json')
const filesPath =
  process.env.MESSAGE_DROP_FILES_DIR ??
  join(__dirname, '..', 'data', 'files')

const store = new MessageStore(dataPath)
const fileStore = new FileStore(filesPath)

let pushNewMessage: (msg: PoolMessage) => void = () => {}

const app = createMessageApp(store, {
  fileStore,
  onMessageCreated: (msg) => pushNewMessage(msg),
})

let discoveryHandle: DiscoveryHandle | null = null

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`[server] listening http://${host}:${info.port}`)
    discoveryHandle = startLanDiscovery(info.port)
  },
)

const clients = new Set<WebSocket>()

function wsBroadcast(payload: unknown): void {
  const data = JSON.stringify(payload)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}

const wss = new WebSocketServer({ server: server as Server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('[ws] connection open')
  telemetry.wsConnections++
  clients.add(ws)
  void store.list().then((messages) => {
    const publicMessages = messages.map(toClientMessage)
    ws.send(JSON.stringify({ type: 'snapshot', messages: publicMessages }))
  })
  ws.on('close', () => {
    clients.delete(ws)
    telemetry.wsConnections = Math.max(0, telemetry.wsConnections - 1)
    console.log('[ws] connection closed')
  })
  ws.on('error', (err) => {
    console.error('[ws] socket error', err)
  })
})

pushNewMessage = (msg: PoolMessage) => {
  wsBroadcast({ type: 'append', message: toClientMessage(msg) })
}

server.on('error', (err) => {
  console.error('[server] error', err)
  process.exit(1)
})

function shutdown(): void {
  discoveryHandle?.stop()
  discoveryHandle = null
  server.close()
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})
