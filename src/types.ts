export type MessageType = 'text' | 'file'

/** Authoritative pool message shape (spec §8). */
export interface PoolMessage {
  id: string
  type: MessageType
  content: string
  file_url: string | null
  timestamp: number
  has_pin: boolean
  pin_hash: string | null
}

export interface CreateMessageBody {
  type: MessageType
  content: string
  file_url?: string | null
  has_pin?: boolean
  /** Plain PIN from client; stored only as pin_hash. */
  pin?: string
}
