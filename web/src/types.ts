export type MessageType = 'text' | 'file'

export type SemverTuple = readonly [number, number, number]

export interface AppUpdateInfo {
  latestTag: string
  htmlUrl: string
  currentVersion: string
}

declare global {
  interface Window {
    MessageDropAndroid?: {
      getAppVersion?: () => string
    }
  }
  interface ImportMetaEnv {
    readonly VITE_RELEASE_GITHUB_REPO?: string
    readonly VITE_APP_VERSION?: string
    readonly VITE_RELEASE_CACHE_TTL_MS?: string
  }
}

export interface PoolMessage {
  id: string
  type: MessageType
  content: string
  file_url: string | null
  timestamp: number
  has_pin: boolean
  pin_hash: string | null
}
