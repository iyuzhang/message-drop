import type { AppUpdateInfo, SemverTuple } from './types'

const GITHUB_API_LATEST = 'https://api.github.com/repos'

/** Parses release tag or plain version into a comparable semver tuple. */
export function parseTagVersion(input: string): SemverTuple | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const core = trimmed.replace(/^v/i, '').split(/[-+]/, 1)[0] ?? ''
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(core)
  if (!m) return null
  const major = Number(m[1])
  const minor = m[2] !== undefined ? Number(m[2]) : 0
  const patch = m[3] !== undefined ? Number(m[3]) : 0
  if (![major, minor, patch].every((n) => Number.isFinite(n) && n >= 0)) {
    return null
  }
  return [major, minor, patch]
}

/** Returns negative if a < b, zero if equal, positive if a > b. */
export function compareSemverTuples(a: SemverTuple, b: SemverTuple): number {
  for (let i = 0; i < 3; i += 1) {
    const d = a[i] - b[i]
    if (d !== 0) return d
  }
  return 0
}

/** Returns whether remote is strictly newer than local. */
export function isRemoteNewer(
  current: SemverTuple,
  remoteTag: string,
): boolean {
  const remote = parseTagVersion(remoteTag)
  if (remote === null) return false
  return compareSemverTuples(remote, current) > 0
}

export const RELEASE_CACHE_KEY_PREFIX = 'message-drop-release-check'

export const DEFAULT_RELEASE_CACHE_TTL_MS = 3_600_000

export const MAX_RELEASE_FETCH_ATTEMPTS = 4

export const RELEASE_FETCH_INITIAL_BACKOFF_MS = 400

export interface ReleaseCachePayload {
  fetchedAt: number
  tagName: string
  htmlUrl: string
}

/** Validates GitHub latest-release JSON shape from an external API. */
export function parseGithubReleasePayload(
  data: unknown,
): { tagName: string; htmlUrl: string } | null {
  if (data === null || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const tagName = o.tag_name
  const htmlUrl = o.html_url
  if (typeof tagName !== 'string' || tagName.length === 0) return null
  if (typeof htmlUrl !== 'string' || !htmlUrl.startsWith('http')) return null
  return { tagName, htmlUrl }
}

type ViteReleaseEnvKey =
  | 'VITE_RELEASE_GITHUB_REPO'
  | 'VITE_APP_VERSION'
  | 'VITE_RELEASE_CACHE_TTL_MS'

function readViteEnvString(key: ViteReleaseEnvKey): string | undefined {
  const meta = import.meta as ImportMeta & {
    env?: Partial<Record<ViteReleaseEnvKey, string | boolean | undefined>>
  }
  const v = meta.env?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function parseGithubRepo(
  raw: string,
): { owner: string; repo: string } | null {
  const s = raw.trim()
  const parts = s.split('/').filter((p) => p.length > 0)
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!owner || !repo) return null
  return { owner, repo }
}

function cacheKeyForRepo(owner: string, repo: string): string {
  return `${RELEASE_CACHE_KEY_PREFIX}:${owner}/${repo}`
}

function getSessionStorage(): Storage | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage
  } catch {
    return null
  }
}

export function readReleaseCache(
  owner: string,
  repo: string,
): ReleaseCachePayload | null {
  const store = getSessionStorage()
  if (store === null) return null
  let raw: string | null
  try {
    raw = store.getItem(cacheKeyForRepo(owner, repo))
  } catch {
    return null
  }
  if (raw === null || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const fetchedAt = o.fetchedAt
  const tagName = o.tagName
  const htmlUrl = o.htmlUrl
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    return null
  }
  if (typeof tagName !== 'string' || tagName.length === 0) return null
  if (typeof htmlUrl !== 'string' || !htmlUrl.startsWith('http')) return null
  return { fetchedAt, tagName, htmlUrl }
}

export function writeReleaseCache(
  owner: string,
  repo: string,
  payload: ReleaseCachePayload,
): void {
  const store = getSessionStorage()
  if (store === null) return
  try {
    store.setItem(cacheKeyForRepo(owner, repo), JSON.stringify(payload))
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveReleaseCacheTtlMs(): number {
  const raw = readViteEnvString('VITE_RELEASE_CACHE_TTL_MS')
  if (raw === undefined) return DEFAULT_RELEASE_CACHE_TTL_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_RELEASE_CACHE_TTL_MS
  return Math.min(n, 24 * 60 * 60 * 1000)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function fetchLatestReleaseOnce(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<{ tagName: string; htmlUrl: string } | null> {
  const url = `${GITHUB_API_LATEST}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`
  const r = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'message-drop-web-release-check',
    },
  })
  if (!r.ok) return null
  const j: unknown = await r.json().catch(() => null)
  return parseGithubReleasePayload(j)
}

export async function fetchLatestReleaseWithRetry(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<{ tagName: string; htmlUrl: string } | null> {
  let attempt = 0
  let backoff = RELEASE_FETCH_INITIAL_BACKOFF_MS
  while (attempt < MAX_RELEASE_FETCH_ATTEMPTS) {
    if (signal?.aborted) return null
    try {
      const got = await fetchLatestReleaseOnce(owner, repo, signal)
      if (got !== null) return got
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
    }
    attempt += 1
    if (attempt >= MAX_RELEASE_FETCH_ATTEMPTS) break
    try {
      await sleep(backoff, signal)
    } catch {
      return null
    }
    backoff = Math.min(backoff * 2, 8000)
  }
  return null
}

/** Reads app version from Android WebView bridge, then Vite env, then null. */
export function getCurrentAppVersionRaw(): string | null {
  try {
    const bridge = window.MessageDropAndroid?.getAppVersion
    if (typeof bridge === 'function') {
      const v = bridge.call(window.MessageDropAndroid)
      if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    }
  } catch {
    /* bridge may throw on some WebView builds */
  }
  const fromEnv = readViteEnvString('VITE_APP_VERSION')
  if (fromEnv !== undefined) return fromEnv.trim()
  return null
}

export interface CheckForAppUpdateOptions {
  signal?: AbortSignal
  nowMs?: number
}

/**
 * Checks GitHub latest release vs current app version (non-throwing).
 * Returns update metadata when a newer release exists; otherwise null.
 */
export async function checkForAppUpdate(
  options: CheckForAppUpdateOptions = {},
): Promise<AppUpdateInfo | null> {
  const { signal, nowMs = Date.now() } = options
  const repoRaw = readViteEnvString('VITE_RELEASE_GITHUB_REPO')
  if (repoRaw === undefined) return null

  const parsedRepo = parseGithubRepo(repoRaw)
  if (parsedRepo === null) return null

  const { owner, repo } = parsedRepo
  const currentRaw = getCurrentAppVersionRaw()
  if (currentRaw === null) return null

  const currentTuple = parseTagVersion(currentRaw)
  if (currentTuple === null) return null

  const ttl = resolveReleaseCacheTtlMs()
  const cached = readReleaseCache(owner, repo)
  const cacheFresh =
    cached !== null && nowMs - cached.fetchedAt < ttl && cached.fetchedAt <= nowMs

  let remote: { tagName: string; htmlUrl: string } | null = null

  if (cacheFresh) {
    remote = { tagName: cached.tagName, htmlUrl: cached.htmlUrl }
  } else {
    remote = await fetchLatestReleaseWithRetry(owner, repo, signal)
    if (remote !== null) {
      writeReleaseCache(owner, repo, {
        fetchedAt: nowMs,
        tagName: remote.tagName,
        htmlUrl: remote.htmlUrl,
      })
    } else if (cached !== null) {
      remote = { tagName: cached.tagName, htmlUrl: cached.htmlUrl }
    }
  }

  if (remote === null) return null
  if (!isRemoteNewer(currentTuple, remote.tagName)) return null

  return {
    latestTag: remote.tagName,
    htmlUrl: remote.htmlUrl,
    currentVersion: currentRaw,
  }
}
