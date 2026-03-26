import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import type { FileStore } from './file-store.js'
import { toClientMessage, toRevealedClientMessage } from './sanitize.js'
import type { MessageStore } from './store.js'
import { getTelemetry } from './telemetry.js'
import type { CreateMessageBody, MessageType, PoolMessage } from './types.js'

export interface MessageAppOptions {
  onMessageCreated?: (msg: PoolMessage) => void
  fileStore?: FileStore
}

export function createMessageApp(
  store: MessageStore,
  opts: MessageAppOptions = {},
): Hono {
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )

  app.get('/health', (c) => c.json({ ok: true }))

  app.get('/debug', async (c) => {
    const messages = await store.list()
    const t = getTelemetry()
    const payload = {
      connections: { websocketClients: t.wsConnections },
      discovery: t.discovery,
      messages: {
        total: messages.length,
        pool: messages.map(toClientMessage).slice(-100),
      },
    }
    const json = JSON.stringify(payload, null, 2)
    const safe = json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return c.html(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Message Drop Debug</title></head><body><pre style="white-space:pre-wrap;font:14px ui-monospace,monospace">${safe}</pre></body></html>`,
    )
  })

  app.get('/api/messages', async (c) => {
    const messages = await store.list()
    const publicMessages = messages.map(toClientMessage)
    console.log(`[messages] listed count=${messages.length}`)
    return c.json({ messages: publicMessages })
  })

  app.post('/api/messages', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON' }, 400)
    }
    const parsed = parseCreateBody(body)
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400)
    }
    try {
      const msg = await store.add(parsed.value)
      console.log(`[messages] created id=${msg.id} type=${msg.type}`)
      opts.onMessageCreated?.(msg)
      return c.json({ message: toClientMessage(msg) }, 201)
    } catch (e) {
      if (e instanceof Error && e.message === 'PIN_REQUIRED') {
        return c.json({ error: 'PIN_REQUIRED' }, 400)
      }
      throw e
    }
  })

  app.post('/api/messages/:id/unlock', async (c) => {
    const id = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON' }, 400)
    }
    const o =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)
        : null
    const pin = o?.pin
    const revealed = await store.tryReveal(id, pin)
    if (!revealed) {
      return c.json({ error: 'FORBIDDEN' }, 403)
    }
    console.log(`[messages] unlocked id=${id}`)
    return c.json({ message: toRevealedClientMessage(revealed) })
  })

  if (opts.fileStore) {
    const files = opts.fileStore
    app.post('/api/upload', async (c) => {
      let body: Record<string, unknown>
      try {
        body = (await c.req.parseBody()) as Record<string, unknown>
      } catch {
        return c.json({ error: 'INVALID_BODY' }, 400)
      }
      const raw = body.file
      const file =
        raw instanceof File
          ? raw
          : Array.isArray(raw)
            ? raw.find((x): x is File => x instanceof File)
            : undefined
      if (!file) return c.json({ error: 'FILE_REQUIRED' }, 400)
      const max = 32 * 1024 * 1024
      const buf = Buffer.from(await file.arrayBuffer())
      if (buf.length > max) return c.json({ error: 'FILE_TOO_LARGE' }, 413)
      const meta = await files.save(
        file.name || 'upload',
        file.type || 'application/octet-stream',
        buf,
      )
      const url = `/api/files/${meta.id}`
      console.log(`[files] stored id=${meta.id} bytes=${meta.size}`)
      return c.json({ file: meta, url })
    })

    app.get('/api/files/:id', async (c) => {
      const id = c.req.param('id')
      const got = await files.get(id)
      if (!got) return c.body(null, 404)
      const originalName = got.meta.originalName
      const safeAsciiName = originalName
        .replace(/["\\]/g, '_')
        .replace(/[^\x20-\x7E]/g, '_')
        .trim() || 'download.bin'
      const headers = new Headers({
        'Content-Type': got.meta.mime,
        'Content-Disposition': `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      })
      const web = Readable.toWeb(got.stream)
      return new Response(web as BodyInit, { status: 200, headers })
    })
  }

  // Serve the React single-page client for PC/mobile WebView.
  app.use('/assets/*', serveStatic({ root: './web/dist' }))
  app.get('/favicon.svg', serveStatic({ root: './web/dist' }))
  app.get('/icons.svg', serveStatic({ root: './web/dist' }))
  app.get('/', serveStatic({ root: './web/dist', path: './index.html' }))

  return app
}

function parseCreateBody(
  body: unknown,
):
  | { ok: true; value: CreateMessageBody }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'BODY_OBJECT_REQUIRED' }
  }
  const o = body as Record<string, unknown>
  const type = o.type
  const content = o.content
  if (type !== 'text' && type !== 'file') {
    return { ok: false, error: 'INVALID_TYPE' }
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'INVALID_CONTENT' }
  }
  const has_pin = Boolean(o.has_pin)
  const pin = o.pin === undefined ? undefined : String(o.pin)
  let file_url: string | null = null
  if (o.file_url !== undefined && o.file_url !== null) {
    const s = String(o.file_url)
    file_url = s === '' ? null : s
  }

  if (type === 'file' && (file_url === null || file_url === '')) {
    return { ok: false, error: 'FILE_URL_REQUIRED' }
  }

  const value: CreateMessageBody = {
    type: type as MessageType,
    content,
    file_url,
    has_pin,
    pin,
  }
  return { ok: true, value }
}
