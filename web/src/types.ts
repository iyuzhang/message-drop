export type MessageType = 'text' | 'file'

export interface PoolMessage {
  id: string
  type: MessageType
  content: string
  file_url: string | null
  timestamp: number
  has_pin: boolean
  pin_hash: string | null
}
