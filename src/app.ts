import type { IncomingHttpHeaders } from 'node:http'
import { networkInterfaces } from 'node:os'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Hono } from 'hono'
import busboy from 'busboy'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import type { AuthManager } from './auth.js'
import { extractBearerToken } from './auth.js'
import type { FileStore } from './file-store.js'
import { toClientMessage, toRevealedClientMessage } from './sanitize.js'
import type { MessageStore } from './store.js'
import { getTelemetry } from './telemetry.js'
import type { CreateMessageBody, MessageType, PoolMessage } from './types.js'

export interface MessageAppOptions {
  onMessageCreated?: (msg: PoolMessage) => void
  fileStore?: FileStore
  authManager?: AuthManager
}

function headersToNodeHeaders(headers: Headers): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {}
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

async function saveUploadedMultipartFile(
  request: Request,
  files: FileStore,
  maxUploadBytes: number,
): Promise<
  | { ok: true; meta: Awaited<ReturnType<FileStore['saveStream']>> }
  | { ok: false; status: 400 | 413 | 500; error: string }
> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return { ok: false, status: 400, error: 'INVALID_BODY' }
  }
  if (request.body === null) {
    return { ok: false, status: 400, error: 'FILE_REQUIRED' }
  }
  const headers = headersToNodeHeaders(request.headers)
  let parser: ReturnType<typeof busboy>
  try {
    parser = busboy({ headers })
  } catch {
    return { ok: false, status: 400, error: 'INVALID_BODY' }
  }
  return await new Promise((resolve) => {
    let settled = false
    let hasFile = false
    let fileSaveError: Error | null = null
    let fileSave: Promise<Awaited<ReturnType<FileStore['saveStream']>> | null> = Promise.resolve(null)
    parser.on('file', (
      _field: string,
      file: NodeJS.ReadableStream,
      info: { filename: string; mimeType: string },
    ) => {
      if (hasFile) {
        file.resume()
        return
      }
      hasFile = true
      const filename = info.filename || 'upload'
      const mimeType = info.mimeType || 'application/octet-stream'
      fileSave = files.saveStream(filename, mimeType, file, maxUploadBytes).catch((error: unknown) => {
        fileSaveError = error instanceof Error ? error : new Error('UPLOAD_FAILED')
        return null
      })
    })
    parser.on('error', () => {
      if (settled) return
      settled = true
      void fileSave.catch(() => {})
      resolve({ ok: false, status: 400, error: 'INVALID_BODY' })
    })
    parser.on('finish', async () => {
      if (settled) return
      settled = true
      if (!hasFile) {
        resolve({ ok: false, status: 400, error: 'FILE_REQUIRED' })
        return
      }
      try {
        const meta = await fileSave
        if (meta === null) {
          if (fileSaveError instanceof Error && fileSaveError.message === 'FILE_TOO_LARGE') {
            resolve({ ok: false, status: 413, error: 'FILE_TOO_LARGE' })
            return
          }
          if (fileSaveError !== null) {
            resolve({ ok: false, status: 500, error: 'UPLOAD_FAILED' })
            return
          }
          resolve({ ok: false, status: 400, error: 'FILE_REQUIRED' })
          return
        }
        resolve({ ok: true, meta })
      } catch (error) {
        if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
          resolve({ ok: false, status: 413, error: 'FILE_TOO_LARGE' })
          return
        }
        resolve({ ok: false, status: 500, error: 'UPLOAD_FAILED' })
      }
    })
    const source = Readable.fromWeb(request.body as unknown as NodeReadableStream)
    source.on('error', () => {
      if (settled) return
      settled = true
      void fileSave.catch(() => {})
      resolve({ ok: false, status: 400, error: 'INVALID_BODY' })
    })
    source.pipe(parser)
  })
}

function resolveMaxUploadBytesFromEnv(): number {
  const raw = process.env.MESSAGE_DROP_MAX_UPLOAD_BYTES
  if (raw === undefined || raw.trim() === '') return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true
  if (!address.startsWith('172.')) return false
  const parts = address.split('.')
  const second = Number(parts[1])
  return Number.isInteger(second) && second >= 16 && second <= 31
}

function isLikelyVirtualInterface(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.startsWith('docker') ||
    n.startsWith('veth') ||
    n.startsWith('br-') ||
    n.startsWith('tailscale') ||
    n.startsWith('utun') ||
    n.startsWith('vboxnet') ||
    n.startsWith('vmnet') ||
    n.startsWith('zt')
  )
}

function buildBaseUrl(protocol: string, host: string, port: number, omitDefaultPort: boolean): string {
  const normalizedHost =
    host.includes(':') && !host.startsWith('[') && !host.endsWith(']')
      ? `[${host}]`
      : host
  const portPart = omitDefaultPort ? '' : `:${port}`
  return `${protocol}://${normalizedHost}${portPart}/`
}

function collectLanIpv4Hosts(): string[] {
  const interfaces = networkInterfaces()
  const preferred: string[] = []
  const fallback: string[] = []
  const seen = new Set<string>()
  for (const [name, records] of Object.entries(interfaces)) {
    if (isLikelyVirtualInterface(name)) continue
    for (const record of records ?? []) {
      if (record.family !== 'IPv4') continue
      if (record.internal) continue
      if (record.address.startsWith('169.254.')) continue
      if (!isPrivateIpv4(record.address)) continue
      if (seen.has(record.address)) continue
      seen.add(record.address)
      if (record.address.startsWith('192.168.') || record.address.startsWith('10.')) {
        preferred.push(record.address)
      } else {
        fallback.push(record.address)
      }
    }
  }
  return [...preferred, ...fallback]
}

function buildEntrypointsFromRequest(requestUrl: URL): {
  current_url: string
  local_url: string
  lan_urls: string[]
  preferred_url: string
} {
  const protocol = requestUrl.protocol === 'https:' ? 'https' : 'http'
  const rawPort = requestUrl.port
  const port = rawPort === '' ? (protocol === 'https' ? 443 : 80) : Number(rawPort)
  const omitDefaultPort = rawPort === ''
  const currentHost = requestUrl.hostname
  const currentUrl = buildBaseUrl(protocol, currentHost, port, omitDefaultPort)
  const localHost =
    currentHost === '0.0.0.0' || currentHost === '::' ? '127.0.0.1' : currentHost
  const localUrl = buildBaseUrl(protocol, localHost, port, omitDefaultPort)
  const lanUrls = collectLanIpv4Hosts()
    .map((host) => buildBaseUrl(protocol, host, port, false))
    .filter((url) => url !== localUrl)
  const preferredUrl = lanUrls[0] ?? localUrl
  return {
    current_url: currentUrl,
    local_url: localUrl,
    lan_urls: lanUrls,
    preferred_url: preferredUrl,
  }
}

export function createMessageApp(
  store: MessageStore,
  opts: MessageAppOptions = {},
): Hono {
  const app = new Hono()
  const loginWindowMs = 60_000
  const loginLimit = 10
  const maxUploadBytes = resolveMaxUploadBytesFromEnv()
  const loginAttempts = new Map<string, { count: number; windowStart: number }>()

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
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

  app.use('/api/*', async (c, next) => {
    const path = c.req.path
    const publicPaths = new Set([
      '/api/auth/status',
      '/api/auth/login',
      '/api/auth/setup',
      '/api/auth/qr-ticket',
      '/api/auth/consume-qr-ticket',
    ])
    const auth = opts.authManager
    if (auth === undefined || !auth.status().enabled || publicPaths.has(path)) {
      await next()
      return
    }
    let token = extractBearerToken(c.req.header('Authorization'))
    if (token === null && path.startsWith('/api/files/')) {
      const tokenFromQuery = new URL(c.req.url).searchParams.get('token')
      if (typeof tokenFromQuery === 'string' && tokenFromQuery !== '') {
        token = tokenFromQuery
      }
    }
    if (token === null || !auth.verifyToken(token)) {
      return c.json({ error: 'UNAUTHORIZED' }, 401)
    }
    await next()
  })

  app.get('/api/entrypoints', (c) => {
    const requestUrl = new URL(c.req.url)
    return c.json(buildEntrypointsFromRequest(requestUrl))
  })

  app.get('/api/auth/status', (c) => {
    const auth = opts.authManager
    const s = auth?.status() ?? { enabled: false, managedByEnv: false }
    return c.json({
      enabled: s.enabled,
      managed_by_env: s.managedByEnv,
    })
  })

  app.post('/api/auth/login', async (c) => {
    const auth = opts.authManager
    if (auth === undefined || !auth.status().enabled) {
      return c.json({ error: 'AUTH_DISABLED' }, 400)
    }
    const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const now = Date.now()
    const current = loginAttempts.get(clientIp)
    if (current !== undefined && now - current.windowStart < loginWindowMs) {
      if (current.count >= loginLimit) {
        return c.json({ error: 'TOO_MANY_ATTEMPTS' }, 429)
      }
      current.count += 1
    } else {
      loginAttempts.set(clientIp, { count: 1, windowStart: now })
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON' }, 400)
    }
    const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const password = typeof o?.password === 'string' ? o.password : ''
    const result = auth.login(password)
    if (result === null) {
      return c.json({ error: 'INVALID_PASSWORD' }, 401)
    }
    loginAttempts.delete(clientIp)
    return c.json({
      token: result.token,
      expires_at: result.expiresAt,
    })
  })

  app.post('/api/auth/setup', async (c) => {
    const auth = opts.authManager
    if (auth === undefined) {
      return c.json({ error: 'AUTH_UNAVAILABLE' }, 400)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON' }, 400)
    }
    const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const password = typeof o?.password === 'string' ? o.password : ''
    try {
      const result = auth.setupPassword(password)
      if (result === 'ALREADY_CONFIGURED') {
        return c.json({ error: 'PASSWORD_ALREADY_CONFIGURED' }, 409)
      }
      if (result === 'MANAGED_BY_ENV') {
        return c.json({ error: 'PASSWORD_MANAGED_BY_ENV' }, 409)
      }
      return c.json({
        token: result.token,
        expires_at: result.expiresAt,
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'PASSWORD_TOO_SHORT') {
        return c.json({ error: 'PASSWORD_TOO_SHORT' }, 400)
      }
      throw e
    }
  })

  app.post('/api/auth/change', async (c) => {
    const auth = opts.authManager
    if (auth === undefined) {
      return c.json({ error: 'AUTH_UNAVAILABLE' }, 400)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON' }, 400)
    }
    const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const oldPassword = typeof o?.old_password === 'string' ? o.old_password : ''
    const newPassword = typeof o?.new_password === 'string' ? o.new_password : ''
    try {
      const result = auth.changePassword(oldPassword, newPassword)
      if (result === 'AUTH_DISABLED') {
        return c.json({ error: 'AUTH_DISABLED' }, 400)
      }
      if (result === 'INVALID_PASSWORD') {
        return c.json({ error: 'INVALID_PASSWORD' }, 401)
      }
      if (result === 'MANAGED_BY_ENV') {
        return c.json({ error: 'PASSWORD_MANAGED_BY_ENV' }, 409)
      }
      return c.json({
        token: result.token,
        expires_at: result.expiresAt,
      })
    } catch (e) {
      if (e instanceof Error && e.message === 'PASSWORD_TOO_SHORT') {
        return c.json({ error: 'PASSWORD_TOO_SHORT' }, 400)
      }
      throw e
    }
  })

  app.post('/api/auth/qr-ticket', (c) => {
    const auth = opts.authManager
    if (auth === undefined || !auth.status().enabled) {
      return c.json({ error: 'AUTH_DISABLED' }, 400)
    }
    const result = auth.issueQrTicket()
    if (result === null) {
      return c.json({ error: 'AUTH_DISABLED' }, 400)
    }
    return c.json({
      ticket: result.ticket,
      expires_at: result.expiresAt,
    })
  })

  app.post('/api/auth/consume-qr-ticket', async (c) => {
    const auth = opts.authManager
    if (auth === undefined || !auth.status().enabled) {
      return c.json({ error: 'AUTH_DISABLED' }, 400)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON' }, 400)
    }
    const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const ticket = typeof o?.ticket === 'string' ? o.ticket : ''
    if (ticket === '') {
      return c.json({ error: 'TICKET_REQUIRED' }, 400)
    }
    const result = auth.consumeQrTicket(ticket)
    if (result === null) {
      return c.json({ error: 'INVALID_OR_EXPIRED_TICKET' }, 401)
    }
    return c.json({
      token: result.token,
      expires_at: result.expiresAt,
    })
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
      const saved = await saveUploadedMultipartFile(c.req.raw, files, maxUploadBytes)
      if (!saved.ok) {
        return c.json({ error: saved.error }, saved.status)
      }
      const meta = saved.meta
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
