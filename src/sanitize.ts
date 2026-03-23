import type { PoolMessage } from './types.js'

/** Strip secrets and hide locked content until unlock (spec §12.4). */
export function toClientMessage(m: PoolMessage): PoolMessage {
  if (m.has_pin) {
    return {
      id: m.id,
      type: m.type,
      content: '',
      file_url: null,
      timestamp: m.timestamp,
      has_pin: true,
      pin_hash: null,
    }
  }
  return { ...m, pin_hash: null }
}

export function toRevealedClientMessage(m: PoolMessage): PoolMessage {
  return { ...m, pin_hash: null }
}
