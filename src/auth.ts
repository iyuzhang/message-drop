import {
  createHmac,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

interface StoredAuthConfig {
  password_hash: string
  version: number
  updated_at: string
}

interface AuthTokenPayload {
  v: number
  iat: number
  exp?: number
  nonce: string
}

export interface AuthStatus {
  enabled: boolean
  managedByEnv: boolean
}

export interface LoginResult {
  token: string
  expiresAt: number | null
}

interface QrTicketRecord {
  expiresAt: number
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(`${padded}${padding}`, 'base64')
}

function hashPassword(password: string): string {
  return createHash('sha256').update(password, 'utf8').digest('hex')
}

function encodeScryptHash(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
  })
  return `scrypt$16384$8$1$${base64UrlEncode(salt)}$${base64UrlEncode(key)}`
}

function verifyPasswordHash(password: string, stored: string): boolean {
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$')
    if (parts.length !== 6) return false
    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    const saltPart = parts[4]
    const keyPart = parts[5]
    if (
      !Number.isInteger(n) ||
      !Number.isInteger(r) ||
      !Number.isInteger(p) ||
      saltPart === undefined ||
      keyPart === undefined
    ) {
      return false
    }
    try {
      const salt = base64UrlDecode(saltPart)
      const expected = base64UrlDecode(keyPart)
      const actual = scryptSync(password, salt, expected.length, {
        N: n,
        r,
        p,
      })
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    } catch {
      return false
    }
  }
  // Legacy fallback for previously persisted unsalted sha256 values.
  return safeCompareHex(hashPassword(password), stored)
}

function parseTtlSeconds(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '' || raw.trim().toLowerCase() === 'never') {
    return null
  }
  const value = raw.trim().toLowerCase()
  const m = /^(\d+)(s|m|h|d)?$/.exec(value)
  if (m === null) {
    throw new Error(
      `Invalid MESSAGE_DROP_AUTH_TOKEN_TTL: ${JSON.stringify(raw)} (examples: never, 3600, 12h, 30d)`,
    )
  }
  const n = Number(m[1])
  const unit = m[2] ?? 's'
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400
  return n * factor
}

function readStoredConfig(authFilePath: string): StoredAuthConfig | null {
  try {
    const raw = readFileSync(authFilePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredAuthConfig>
    if (
      typeof parsed.password_hash !== 'string' ||
      typeof parsed.version !== 'number' ||
      !Number.isInteger(parsed.version) ||
      parsed.version < 1
    ) {
      return null
    }
    return {
      password_hash: parsed.password_hash,
      version: parsed.version,
      updated_at:
        typeof parsed.updated_at === 'string'
          ? parsed.updated_at
          : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function writeStoredConfig(authFilePath: string, cfg: StoredAuthConfig): void {
  mkdirSync(dirname(authFilePath), { recursive: true })
  const tmp = `${authFilePath}.${Date.now()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8')
  renameSync(tmp, authFilePath)
}

function safeCompareHex(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (aa.length !== bb.length) return false
  return timingSafeEqual(aa, bb)
}

export class AuthManager {
  private passwordHash: string | null = null
  private version = 1
  private readonly managedByEnv: boolean
  private readonly tokenTtlSeconds: number | null
  private readonly qrTicketTtlMs: number
  private readonly qrTickets = new Map<string, QrTicketRecord>()

  constructor(
    private readonly authFilePath: string,
    envPassword: string | undefined,
    rawTtl: string | undefined,
    rawQrTicketTtl: string | undefined,
  ) {
    this.tokenTtlSeconds = parseTtlSeconds(rawTtl)
    const parsedQrTtl = parseTtlSeconds(rawQrTicketTtl)
    this.qrTicketTtlMs = (parsedQrTtl ?? 3 * 60 * 60) * 1000
    if (envPassword !== undefined && envPassword !== '') {
      this.passwordHash = hashPassword(envPassword)
      this.managedByEnv = true
      const stored = readStoredConfig(this.authFilePath)
      this.version = stored?.version ?? 1
      return
    }
    this.managedByEnv = false
    const stored = readStoredConfig(this.authFilePath)
    if (stored !== null) {
      this.passwordHash = stored.password_hash
      this.version = stored.version
    }
  }

  status(): AuthStatus {
    return {
      enabled: this.passwordHash !== null,
      managedByEnv: this.managedByEnv,
    }
  }

  verifyToken(token: string | null): boolean {
    if (this.passwordHash === null) return true
    if (typeof token !== 'string' || token === '') return false
    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [payloadB64, sigB64] = parts
    if (payloadB64 === undefined || sigB64 === undefined) return false
    const expectedSig = createHmac(
      'sha256',
      `${this.passwordHash}:${this.version}`,
    )
      .update(payloadB64, 'utf8')
      .digest()
    let actualSig: Buffer
    let payload: AuthTokenPayload
    try {
      actualSig = base64UrlDecode(sigB64)
      payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as AuthTokenPayload
    } catch {
      return false
    }
    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      return false
    }
    if (payload.v !== this.version) return false
    if (typeof payload.iat !== 'number') return false
    if (payload.exp !== undefined && Date.now() / 1000 > payload.exp) return false
    return true
  }

  login(password: string): LoginResult | null {
    if (this.passwordHash === null) return null
    if (!verifyPasswordHash(password, this.passwordHash)) return null
    return this.issueSessionToken()
  }

  private issueSessionToken(): LoginResult {
    if (this.passwordHash === null) {
      throw new Error('AUTH_DISABLED')
    }
    const now = Math.floor(Date.now() / 1000)
    const exp =
      this.tokenTtlSeconds === null ? undefined : now + this.tokenTtlSeconds
    const payload: AuthTokenPayload = {
      v: this.version,
      iat: now,
      ...(exp !== undefined ? { exp } : {}),
      nonce: base64UrlEncode(randomBytes(8)),
    }
    const payloadB64 = base64UrlEncode(JSON.stringify(payload))
    const sigB64 = base64UrlEncode(
      createHmac('sha256', `${this.passwordHash}:${this.version}`)
        .update(payloadB64, 'utf8')
        .digest(),
    )
    return {
      token: `${payloadB64}.${sigB64}`,
      expiresAt: exp === undefined ? null : exp * 1000,
    }
  }

  private pruneQrTickets(now = Date.now()): void {
    for (const [key, item] of this.qrTickets) {
      if (item.expiresAt <= now) {
        this.qrTickets.delete(key)
      }
    }
  }

  issueQrTicket(): { ticket: string; expiresAt: number } | null {
    if (this.passwordHash === null) return null
    const now = Date.now()
    this.pruneQrTickets(now)
    const ticket = base64UrlEncode(randomBytes(24))
    const expiresAt = now + this.qrTicketTtlMs
    this.qrTickets.set(ticket, { expiresAt })
    return { ticket, expiresAt }
  }

  consumeQrTicket(ticket: string): LoginResult | null {
    if (this.passwordHash === null) return null
    const now = Date.now()
    this.pruneQrTickets(now)
    const record = this.qrTickets.get(ticket)
    if (record === undefined) return null
    this.qrTickets.delete(ticket)
    if (record.expiresAt <= now) return null
    return this.issueSessionToken()
  }

  setupPassword(password: string): LoginResult | 'ALREADY_CONFIGURED' | 'MANAGED_BY_ENV' {
    if (this.managedByEnv) return 'MANAGED_BY_ENV'
    if (this.passwordHash !== null) return 'ALREADY_CONFIGURED'
    const normalized = password.trim()
    if (normalized.length < 4) {
      throw new Error('PASSWORD_TOO_SHORT')
    }
    this.passwordHash = encodeScryptHash(normalized)
    this.version = 1
    this.qrTickets.clear()
    writeStoredConfig(this.authFilePath, {
      password_hash: this.passwordHash,
      version: this.version,
      updated_at: new Date().toISOString(),
    })
    const login = this.login(normalized)
    if (login === null) {
      throw new Error('AUTH_SETUP_FAILED')
    }
    return login
  }

  changePassword(
    oldPassword: string,
    newPassword: string,
  ):
    | LoginResult
    | 'AUTH_DISABLED'
    | 'INVALID_PASSWORD'
    | 'MANAGED_BY_ENV' {
    if (this.managedByEnv) return 'MANAGED_BY_ENV'
    if (this.passwordHash === null) return 'AUTH_DISABLED'
    if (!verifyPasswordHash(oldPassword, this.passwordHash)) {
      return 'INVALID_PASSWORD'
    }
    const normalized = newPassword.trim()
    if (normalized.length < 4) {
      throw new Error('PASSWORD_TOO_SHORT')
    }
    this.passwordHash = encodeScryptHash(normalized)
    this.version += 1
    this.qrTickets.clear()
    writeStoredConfig(this.authFilePath, {
      password_hash: this.passwordHash,
      version: this.version,
      updated_at: new Date().toISOString(),
    })
    const login = this.login(normalized)
    if (login === null) {
      throw new Error('AUTH_CHANGE_FAILED')
    }
    return login
  }
}

export function extractBearerToken(headerValue: string | undefined): string | null {
  if (headerValue === undefined) return null
  const m = /^Bearer\s+(.+)$/.exec(headerValue)
  return m?.[1] ?? null
}
