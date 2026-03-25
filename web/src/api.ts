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

export async function fetchMessages(apiBase: string): Promise<PoolMessage[]> {
  const r = await fetch(`${apiBase}/api/messages`)
  if (!r.ok) throw new Error(`list failed: ${r.status}`)
  const j = (await r.json()) as { messages?: PoolMessage[] }
  return j.messages ?? []
}

export async function postTextMessage(
  apiBase: string,
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      content: body.content,
      file_url: body.file_url ?? null,
      has_pin: body.has_pin,
      ...(body.has_pin ? { pin: body.pin ?? '' } : {}),
    }),
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `send failed: ${r.status}`)
  }
  const j = (await r.json()) as { message: PoolMessage }
  return j.message
}

export async function uploadBlob(
  apiBase: string,
  file: globalThis.File,
): Promise<{ url: string }> {
  const fd = new FormData()
  fd.set('file', file)
  const r = await fetch(`${apiBase}/api/upload`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`upload failed: ${r.status}`)
  const j = (await r.json()) as { url?: string }
  if (!j.url) throw new Error('upload response')
  return { url: j.url }
}

export async function unlockMessage(
  apiBase: string,
  id: string,
  pin: string,
): Promise<PoolMessage> {
  const r = await fetch(`${apiBase}/api/messages/${id}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  })
  if (!r.ok) throw new Error('unlock failed')
  const j = (await r.json()) as { message: PoolMessage }
  return j.message
}
