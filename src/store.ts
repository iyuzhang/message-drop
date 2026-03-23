import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CreateMessageBody, PoolMessage } from './types.js'

const MAX_MESSAGES = 2000
const MIN_RETAINED = 100

function hashPin(pin: string): string {
  return createHash('sha256').update(pin, 'utf8').digest('hex')
}

export class MessageStore {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private async loadRaw(): Promise<PoolMessage[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isPoolMessage)
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return []
      throw e
    }
  }

  private async persist(messages: PoolMessage[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${randomUUID()}.tmp`
    const payload = `${JSON.stringify(messages)}\n`
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, this.filePath)
  }

  /** Serialize writes to avoid torn JSON under concurrent requests. */
  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(task, task)
    this.writeChain = next.catch(() => {})
    return next
  }

  async list(): Promise<PoolMessage[]> {
    const all = await this.loadRaw()
    return [...all].sort((a, b) => b.timestamp - a.timestamp)
  }

  async add(body: CreateMessageBody): Promise<PoolMessage> {
    const has_pin = Boolean(body.has_pin)
    if (has_pin && (body.pin === undefined || body.pin === '')) {
      throw new Error('PIN_REQUIRED')
    }
    const msg: PoolMessage = {
      id: randomUUID(),
      type: body.type,
      content: body.content,
      file_url:
        body.file_url === undefined || body.file_url === ''
          ? null
          : body.file_url,
      timestamp: Date.now(),
      has_pin,
      pin_hash: has_pin && body.pin !== undefined ? hashPin(body.pin) : null,
    }

    await this.enqueueWrite(async () => {
      let list = await this.loadRaw()
      list = [...list, msg]
      if (list.length > MAX_MESSAGES) {
        list = list
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-Math.max(MIN_RETAINED, MAX_MESSAGES))
      }
      await this.persist(list)
    })

    return msg
  }

  /** For tests: reset backing file. */
  async clear(): Promise<void> {
    await this.enqueueWrite(async () => {
      try {
        await unlink(this.filePath)
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException
        if (err.code !== 'ENOENT') throw e
      }
    })
  }

  async getById(id: string): Promise<PoolMessage | null> {
    const list = await this.loadRaw()
    return list.find((m) => m.id === id) ?? null
  }

  /** Returns full message (no pin_hash in return) if PIN matches or message is not PIN-gated. */
  async tryReveal(id: string, pin: unknown): Promise<PoolMessage | null> {
    if (typeof pin !== 'string' || pin === '') return null
    const m = await this.getById(id)
    if (!m) return null
    if (!m.has_pin) {
      return { ...m, pin_hash: null }
    }
    if (!m.pin_hash || hashPin(pin) !== m.pin_hash) return null
    return { ...m, pin_hash: null }
  }
}

function isPoolMessage(v: unknown): v is PoolMessage {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    (o.type === 'text' || o.type === 'file') &&
    typeof o.content === 'string' &&
    (o.file_url === null || typeof o.file_url === 'string') &&
    typeof o.timestamp === 'number' &&
    typeof o.has_pin === 'boolean' &&
    (o.pin_hash === null || typeof o.pin_hash === 'string')
  )
}
