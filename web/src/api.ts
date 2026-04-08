import type { PoolMessage } from './types'

export type { AppUpdateInfo } from './types'
export { checkForAppUpdate } from './release'

export function getApiBase(): string {
  const v = import.meta.env.VITE_API_BASE
  if (typeof v === 'string' && v.length > 0) return v.replace(/\/$/, '')
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://127.0.0.1:8787'
}

export function wsUrlFromApiBase(apiBase: string): string {
  const u = new URL(apiBase)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/ws'
  u.search = ''
  u.hash = ''
  return u.toString()
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface AuthStatus {
  enabled: boolean
  managed_by_env: boolean
}

function authHeaders(token: string | null, contentTypeJson = false): HeadersInit {
  const headers: Record<string, string> = {}
  if (contentTypeJson) {
    headers['Content-Type'] = 'application/json'
  }
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function readApiError(resp: Response, fallback: string): Promise<never> {
  let code = fallback
  try {
    const j = (await resp.json()) as { error?: string }
    code = j.error ?? fallback
  } catch {
    // ignore JSON parse failures
  }
  throw new ApiError(code, resp.status, code)
}

export async function fetchAuthStatus(apiBase: string): Promise<AuthStatus> {
  const r = await fetch(`${apiBase}/api/auth/status`)
  if (!r.ok) {
    await readApiError(r, 'AUTH_STATUS_FAILED')
  }
  return (await r.json()) as AuthStatus
}

export async function loginWithPassword(
  apiBase: string,
  password: string,
): Promise<{ token: string; expires_at: number | null }> {
  const r = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: authHeaders(null, true),
    body: JSON.stringify({ password }),
  })
  if (!r.ok) {
    await readApiError(r, 'AUTH_LOGIN_FAILED')
  }
  return (await r.json()) as { token: string; expires_at: number | null }
}

export async function setupServerPassword(
  apiBase: string,
  password: string,
): Promise<{ token: string; expires_at: number | null }> {
  const r = await fetch(`${apiBase}/api/auth/setup`, {
    method: 'POST',
    headers: authHeaders(null, true),
    body: JSON.stringify({ password }),
  })
  if (!r.ok) {
    await readApiError(r, 'AUTH_SETUP_FAILED')
  }
  return (await r.json()) as { token: string; expires_at: number | null }
}

export async function fetchMessages(apiBase: string, token: string | null): Promise<PoolMessage[]> {
  const r = await fetch(`${apiBase}/api/messages`, {
    headers: authHeaders(token),
  })
  if (!r.ok) {
    await readApiError(r, 'LIST_FAILED')
  }
  const j = (await r.json()) as { messages?: PoolMessage[] }
  return j.messages ?? []
}

export async function postTextMessage(
  apiBase: string,
  token: string | null,
  body: {
    content: string
    has_pin: boolean
    pin?: string
    type?: 'text' | 'file'
    file_url?: string
  },
): Promise<PoolMessage> {
  const type = body.type ?? 'text'
  const r = await fetch(`${apiBase}/api/messages`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      type,
      content: body.content,
      file_url: body.file_url ?? null,
      has_pin: body.has_pin,
      ...(body.has_pin ? { pin: body.pin ?? '' } : {}),
    }),
  })
  if (!r.ok) {
    await readApiError(r, 'SEND_FAILED')
  }
  const j = (await r.json()) as { message: PoolMessage }
  return j.message
}

export async function uploadBlob(
  apiBase: string,
  token: string | null,
  file: globalThis.File,
): Promise<{ url: string }> {
  const fd = new FormData()
  fd.set('file', file)
  const r = await fetch(`${apiBase}/api/upload`, {
    method: 'POST',
    headers: authHeaders(token),
    body: fd,
  })
  if (!r.ok) {
    await readApiError(r, 'UPLOAD_FAILED')
  }
  const j = (await r.json()) as { url?: string }
  if (!j.url) throw new Error('upload response')
  return { url: j.url }
}

export async function unlockMessage(
  apiBase: string,
  token: string | null,
  id: string,
  pin: string,
): Promise<PoolMessage> {
  const r = await fetch(`${apiBase}/api/messages/${id}/unlock`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ pin }),
  })
  if (!r.ok) {
    await readApiError(r, 'UNLOCK_FAILED')
  }
  const j = (await r.json()) as { message: PoolMessage }
  return j.message
}
