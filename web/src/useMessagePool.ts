import { useCallback, useEffect, useRef, useState } from 'react'
import { wsUrlFromApiBase } from './api'
import type { PoolMessage } from './types'

type ConnState = 'connecting' | 'live' | 'reconnecting'

function sortMessages(map: Map<string, PoolMessage>): PoolMessage[] {
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp)
}

export function useMessagePool(apiBase: string) {
  const [messages, setMessages] = useState<PoolMessage[]>([])
  const [conn, setConn] = useState<ConnState>('connecting')
  const mapRef = useRef(new Map<string, PoolMessage>())
  const attemptRef = useRef(0)

  const applySnapshot = useCallback((list: PoolMessage[]) => {
    const m = new Map<string, PoolMessage>()
    for (const msg of list) m.set(msg.id, msg)
    mapRef.current = m
    setMessages(sortMessages(m))
  }, [])

  const upsert = useCallback((msg: PoolMessage) => {
    const m = mapRef.current
    m.set(msg.id, msg)
    setMessages(sortMessages(m))
  }, [])

  useEffect(() => {
    let ws: WebSocket | null = null
    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const clearTimer = () => {
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      setConn('reconnecting')
      const n = attemptRef.current++
      const delay = Math.min(3000, 500 * 2 ** Math.min(n, 4))
      reconnectTimer = setTimeout(connect, delay)
    }

    const connect = () => {
      if (cancelled) return
      setConn((c) => (c === 'live' ? c : 'connecting'))
      const url = wsUrlFromApiBase(apiBase)
      ws = new WebSocket(url)

      ws.onopen = () => {
        if (cancelled) return
        attemptRef.current = 0
        setConn('live')
      }

      ws.onmessage = (ev) => {
        if (cancelled) return
        let data: unknown
        try {
          data = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (typeof data !== 'object' || data === null) return
        const o = data as Record<string, unknown>
        if (o.type === 'snapshot' && Array.isArray(o.messages)) {
          applySnapshot(o.messages as PoolMessage[])
        }
        if (o.type === 'append' && o.message && typeof o.message === 'object') {
          upsert(o.message as PoolMessage)
        }
      }

      ws.onclose = () => {
        if (cancelled) return
        scheduleReconnect()
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearTimer()
      ws?.close()
    }
  }, [apiBase, applySnapshot, upsert])

  const mergeFromServer = useCallback((list: PoolMessage[]) => {
    const m = mapRef.current
    for (const msg of list) m.set(msg.id, msg)
    setMessages(sortMessages(m))
  }, [])

  return { messages, conn, mergeFromServer, upsert }
}
