import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
