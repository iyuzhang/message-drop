import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface FileMeta {
  id: string
  originalName: string
  mime: string
  size: number
}

export class FileStore {
  constructor(private readonly rootDir: string) {}

  private binPath(id: string): string {
    return join(this.rootDir, `${id}.bin`)
  }

  private metaPath(id: string): string {
    return join(this.rootDir, `${id}.meta.json`)
  }

  async save(
    originalName: string,
    mime: string,
    data: Buffer,
  ): Promise<FileMeta> {
    const id = randomUUID()
    await mkdir(this.rootDir, { recursive: true })
    const tmpBin = join(this.rootDir, `.${id}.bin.tmp`)
    const tmpMeta = join(this.rootDir, `.${id}.meta.tmp`)
    await writeFile(tmpBin, data)
    const meta: FileMeta = {
      id,
      originalName,
      mime: mime || 'application/octet-stream',
      size: data.length,
    }
    await writeFile(tmpMeta, `${JSON.stringify(meta)}\n`, 'utf8')
    await rename(tmpBin, this.binPath(id))
    await rename(tmpMeta, this.metaPath(id))
    return meta
  }

  async saveStream(
    originalName: string,
    mime: string,
    stream: NodeJS.ReadableStream,
    maxBytes = 0,
  ): Promise<FileMeta> {
    const id = randomUUID()
    await mkdir(this.rootDir, { recursive: true })
    const tmpBin = join(this.rootDir, `.${id}.bin.tmp`)
    const tmpMeta = join(this.rootDir, `.${id}.meta.tmp`)
    let size = 0
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += Buffer.byteLength(chunk)
        if (maxBytes > 0 && size > maxBytes) {
          callback(new Error('FILE_TOO_LARGE'))
          return
        }
        callback(null, chunk)
      },
    })
    try {
      await pipeline(stream, counter, createWriteStream(tmpBin))
      const meta: FileMeta = {
        id,
        originalName,
        mime: mime || 'application/octet-stream',
        size,
      }
      await writeFile(tmpMeta, `${JSON.stringify(meta)}\n`, 'utf8')
      await rename(tmpBin, this.binPath(id))
      await rename(tmpMeta, this.metaPath(id))
      return meta
    } catch (error) {
      await Promise.all([
        unlink(tmpBin).catch(() => {}),
        unlink(tmpMeta).catch(() => {}),
      ])
      throw error
    }
  }

  async get(id: string): Promise<{ meta: FileMeta; stream: ReturnType<typeof createReadStream> } | null> {
    if (!UUID_RE.test(id)) return null
    try {
      const raw = await readFile(this.metaPath(id), 'utf8')
      const meta = JSON.parse(raw) as FileMeta
      const stream = createReadStream(this.binPath(id))
      return { meta, stream }
    } catch {
      return null
    }
  }
}
