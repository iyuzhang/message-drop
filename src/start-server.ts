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

export interface MessageDropServerConfig {
  host: string
  port: number
  dataPath: string
  filesPath: string
}

/**
 * Reads server configuration from process environment with repository-relative defaults.
 */
export function resolveMessageDropServerConfigFromEnv(): MessageDropServerConfig {
  const port = parseListenPort(process.env.PORT, 8787)
  const host = process.env.HOST ?? '0.0.0.0'
  const dataPath =
    process.env.MESSAGE_DROP_DATA_PATH ??
    join(__dirname, '..', 'data', 'messages.json')
  const filesPath =
    process.env.MESSAGE_DROP_FILES_DIR ??
    join(__dirname, '..', 'data', 'files')
  return { host, port, dataPath, filesPath }
}

/**
 * Starts the HTTP server, WebSocket fan-out, and LAN discovery for message-drop.
 */
export function startMessageDropServer(config: MessageDropServerConfig): void {
  const store = new MessageStore(config.dataPath)
  const fileStore = new FileStore(config.filesPath)

  let pushNewMessage: (msg: PoolMessage) => void = () => {}

  const app = createMessageApp(store, {
    fileStore,
    onMessageCreated: (msg) => pushNewMessage(msg),
  })

  let discoveryHandle: DiscoveryHandle | null = null

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    (info) => {
      console.log(
        `[server] listening http://${config.host}:${info.port}`,
      )
      const displayHost =
        config.host === '0.0.0.0' ? '127.0.0.1' : config.host
      console.log(`message-drop: http://${displayHost}:${info.port}/`)
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
    void store
      .list()
      .then((messages) => {
        const publicMessages = messages.map(toClientMessage)
        if (ws.readyState !== WebSocket.OPEN) {
          return
        }
        try {
          ws.send(
            JSON.stringify({ type: 'snapshot', messages: publicMessages }),
          )
        } catch (err: unknown) {
          console.error('[ws] snapshot send failed', err)
        }
      })
      .catch((err: unknown) => {
        console.error('[ws] snapshot load failed', err)
        try {
          ws.close()
        } catch {
          ws.terminate()
        }
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

  function shutdown(onClosed: () => void): void {
    discoveryHandle?.stop()
    discoveryHandle = null
    for (const ws of clients) {
      try {
        ws.terminate()
      } catch {
        /* ignore close errors during shutdown */
      }
    }
    clients.clear()
    wss.close(() => {
      server.close(() => {
        onClosed()
      })
    })
  }

  process.on('SIGINT', () => {
    shutdown(() => {
      process.exit(0)
    })
  })
  process.on('SIGTERM', () => {
    shutdown(() => {
      process.exit(0)
    })
  })
}

function parseListenPort(raw: string | undefined, defaultPort: number): number {
  if (raw === undefined || raw === '') {
    return defaultPort
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      `Invalid PORT: ${JSON.stringify(raw)} (expected integer 1-65535)`,
    )
  }
  return n
}
