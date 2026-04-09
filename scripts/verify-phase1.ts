import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createMessageApp } from '../src/app.js'
import { MessageStore } from '../src/store.js'

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'message-drop-p1-'))
  const dataPath = join(dir, 'messages.json')
  const store = new MessageStore(dataPath)
  const app = createMessageApp(store)

  const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
    void run(info.port)
      .catch((e) => {
        console.error(e)
        process.exitCode = 1
      })
      .finally(() => {
        server.close(() => {
          void rm(dir, { recursive: true, force: true }).then(() => {
            process.exit(process.exitCode ?? 0)
          })
        })
      })
  })
}

async function run(port: number): Promise<void> {
  const base = `http://127.0.0.1:${port}`

  const h = await fetch(`${base}/health`)
  if (!h.ok) throw new Error(`health: ${h.status}`)
  const hj = (await h.json()) as { ok?: boolean }
  if (hj.ok !== true) throw new Error('health body')

  const entrypoints = await fetch(`${base}/api/entrypoints`)
  if (!entrypoints.ok) throw new Error(`entrypoints: ${entrypoints.status}`)
  const ej = (await entrypoints.json()) as {
    current_url?: string
    local_url?: string
    lan_urls?: string[]
    preferred_url?: string
  }
  if (
    typeof ej.current_url !== 'string' ||
    typeof ej.local_url !== 'string' ||
    !Array.isArray(ej.lan_urls) ||
    typeof ej.preferred_url !== 'string'
  ) {
    throw new Error('entrypoints body contract')
  }
  if (!ej.current_url.startsWith('http://127.0.0.1:')) {
    throw new Error('entrypoints current_url should use loopback test origin')
  }
  if (!ej.preferred_url.startsWith('http://')) {
    throw new Error('entrypoints preferred_url should be http url')
  }

  const list0 = await fetch(`${base}/api/messages`)
  if (!list0.ok) throw new Error(`list0: ${list0.status}`)
  const j0 = (await list0.json()) as { messages?: unknown[] }
  if (!Array.isArray(j0.messages) || j0.messages.length !== 0) {
    throw new Error('expected empty messages')
  }

  const post = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'text', content: 'hello-phase1' }),
  })
  if (post.status !== 201) throw new Error(`post: ${post.status}`)
  const pj = (await post.json()) as {
    message?: { id?: string; content?: string; has_pin?: boolean }
  }
  if (!pj.message?.id || pj.message.content !== 'hello-phase1') {
    throw new Error('post body')
  }
  if (pj.message.has_pin !== false) throw new Error('has_pin default')

  const postPin = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'text',
      content: 'secret',
      has_pin: true,
      pin: '4242',
    }),
  })
  if (postPin.status !== 201) throw new Error(`postPin: ${postPin.status}`)
  const pjp = (await postPin.json()) as {
    message?: { id?: string; has_pin?: boolean; content?: string; pin_hash?: null }
  }
  if (
    !pjp.message?.has_pin ||
    pjp.message.content !== '' ||
    pjp.message.pin_hash !== null
  ) {
    throw new Error('pin message should be redacted for clients')
  }
  const pinId = pjp.message.id
  if (!pinId) throw new Error('pin id')

  const badUnlock = await fetch(`${base}/api/messages/${pinId}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'wrong' }),
  })
  if (badUnlock.status !== 403) throw new Error(`badUnlock: ${badUnlock.status}`)

  const okUnlock = await fetch(`${base}/api/messages/${pinId}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '4242' }),
  })
  if (okUnlock.status !== 200) throw new Error(`okUnlock: ${okUnlock.status}`)
  const uj = (await okUnlock.json()) as { message?: { content?: string } }
  if (uj.message?.content !== 'secret') throw new Error('unlock content')

  const badPin = await fetch(`${base}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'text',
      content: 'x',
      has_pin: true,
    }),
  })
  if (badPin.status !== 400) throw new Error(`badPin: ${badPin.status}`)

  const list1 = await fetch(`${base}/api/messages`)
  const j1 = (await list1.json()) as { messages?: unknown[] }
  if (!Array.isArray(j1.messages) || j1.messages.length !== 2) {
    throw new Error('expected 2 messages')
  }

  console.log('Phase 1 verification: OK')
}

void main()
