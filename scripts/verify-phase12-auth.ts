import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

function assert(cond: boolean, message: string): asserts cond {
  if (!cond) {
    throw new Error(message)
  }
}

async function waitForServer(base: string, attempts = 80): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch {
      // ignore while booting
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`server not ready: ${base}`)
}

async function jsonRequest(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await fetch(url, init)
  const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  return { status: resp.status, body }
}

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

async function expectWsUnauthorized(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error('ws unauthorized timeout'))
    }, 2500)
    ws.once('close', (code) => {
      clearTimeout(timeout)
      if (code !== 4401) {
        reject(new Error(`expected ws close 4401, got ${code}`))
        return
      }
      resolve()
    })
    ws.once('error', () => {
      // some runtimes emit error before close; rely on close code check.
    })
  })
}

async function expectWsSnapshot(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error('ws snapshot timeout'))
    }, 2500)
    ws.once('message', (raw) => {
      clearTimeout(timeout)
      const text = String(raw)
      if (!text.includes('"type":"snapshot"')) {
        reject(new Error(`expected snapshot, got: ${text.slice(0, 120)}`))
        return
      }
      ws.close()
      resolve()
    })
    ws.once('error', reject)
  })
}

function startServer(root: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(
    'pnpm',
    ['exec', 'tsx', 'src/server.ts'],
    {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

async function stopServer(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM')
  await Promise.race([
    once(proc, 'exit'),
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ])
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = await mkdtemp(join(tmpdir(), 'message-drop-auth-'))
  const base = 'http://127.0.0.1:35887'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '35887',
    MESSAGE_DROP_DATA_PATH: join(dir, 'messages.json'),
    MESSAGE_DROP_FILES_DIR: join(dir, 'files'),
    MESSAGE_DROP_AUTH_TOKEN_TTL: 'never',
  }
  let proc = startServer(root, env)
  try {
    await waitForServer(base)

    const status0 = await jsonRequest(`${base}/api/auth/status`)
    assert(status0.status === 200, `status0: ${status0.status}`)
    assert(status0.body.enabled === false, 'auth should be disabled initially')

    const shortSetup = await jsonRequest(`${base}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: '123' }),
    })
    assert(shortSetup.status === 400, `short setup: ${shortSetup.status}`)

    const setup = await jsonRequest(`${base}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'alpha1234' }),
    })
    assert(setup.status === 200, `setup: ${setup.status}`)
    const token1 = setup.body.token
    assert(typeof token1 === 'string' && token1.length > 20, 'setup token missing')

    const listNoAuth = await jsonRequest(`${base}/api/messages`)
    assert(listNoAuth.status === 401, `list no auth: ${listNoAuth.status}`)

    const listAuth = await jsonRequest(`${base}/api/messages`, {
      headers: authHeader(token1),
    })
    assert(listAuth.status === 200, `list auth: ${listAuth.status}`)

    const uploadForm = new FormData()
    uploadForm.set(
      'file',
      new Blob([Buffer.from('auth-download-regression', 'utf8')], {
        type: 'text/plain',
      }),
      'regression-auth-download.txt',
    )
    const uploadResp = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: authHeader(token1),
      body: uploadForm,
    })
    assert(uploadResp.status === 200, `upload: ${uploadResp.status}`)
    const uploadText = await uploadResp.text()
    let uploadBody: { url?: string } = {}
    try {
      uploadBody = JSON.parse(uploadText) as { url?: string }
    } catch {
      throw new Error(`upload response must be JSON, got: ${uploadText.slice(0, 120)}`)
    }
    assert(typeof uploadBody.url === 'string', 'upload url missing')
    assert(uploadBody.url.startsWith('/api/files/'), `unexpected upload url: ${uploadBody.url}`)
    const fileUrl = new URL(uploadBody.url, base)

    const fileNoAuth = await fetch(fileUrl)
    assert(fileNoAuth.status === 401, `file no auth should be 401: ${fileNoAuth.status}`)

    const fileAuthHeader = await fetch(fileUrl, {
      headers: authHeader(token1),
    })
    assert(fileAuthHeader.status === 200, `file auth header should be 200: ${fileAuthHeader.status}`)
    const fileAuthHeaderText = await fileAuthHeader.text()
    assert(
      fileAuthHeaderText === 'auth-download-regression',
      `file auth header content mismatch: ${fileAuthHeaderText.slice(0, 80)}`,
    )

    const fileAuthQuery = new URL(fileUrl)
    fileAuthQuery.searchParams.set('token', token1)
    const fileAuthQueryResp = await fetch(fileAuthQuery)
    assert(fileAuthQueryResp.status === 200, `file auth query should be 200: ${fileAuthQueryResp.status}`)
    const fileAuthQueryText = await fileAuthQueryResp.text()
    assert(
      fileAuthQueryText === 'auth-download-regression',
      `file auth query content mismatch: ${fileAuthQueryText.slice(0, 80)}`,
    )

    await expectWsUnauthorized(`ws://127.0.0.1:35887/ws`)
    await expectWsSnapshot(`ws://127.0.0.1:35887/ws?token=${encodeURIComponent(token1)}`)

    const change = await jsonRequest(`${base}/api/auth/change`, {
      method: 'POST',
      headers: {
        ...authHeader(token1),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        old_password: 'alpha1234',
        new_password: 'beta5678',
      }),
    })
    assert(change.status === 200, `change: ${change.status}`)
    const token2 = change.body.token
    assert(typeof token2 === 'string' && token2.length > 20, 'change token missing')

    const oldToken = await jsonRequest(`${base}/api/messages`, {
      headers: authHeader(token1),
    })
    assert(oldToken.status === 401, `old token should be rejected: ${oldToken.status}`)

    const badLogin = await jsonRequest(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'alpha1234' }),
    })
    assert(badLogin.status === 401, `old password login: ${badLogin.status}`)

    const goodLogin = await jsonRequest(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'beta5678' }),
    })
    assert(goodLogin.status === 200, `new password login: ${goodLogin.status}`)

    await stopServer(proc)
    proc = startServer(root, env)
    await waitForServer(base)

    const tokenAfterRestart = await jsonRequest(`${base}/api/messages`, {
      headers: authHeader(token2),
    })
    assert(
      tokenAfterRestart.status === 200,
      `token after restart: ${tokenAfterRestart.status}`,
    )

    console.log('Phase 12 auth verification: OK')
  } finally {
    await stopServer(proc).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
