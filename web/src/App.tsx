import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchMessages,
  getApiBase,
  postTextMessage,
  unlockMessage,
  uploadBlob,
} from './api'
import { useMessagePool } from './useMessagePool'
import './App.css'

export default function App() {
  const apiBase = getApiBase()
  const { messages, conn, mergeFromServer, upsert } = useMessagePool(apiBase)
  const [text, setText] = useState('')
  const [usePin, setUsePin] = useState(false)
  const [pin, setPin] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const send = useCallback(async () => {
    const content = text.trim()
    if (!content) return
    setError(null)
    try {
      if (usePin && !pin) {
        setError('PIN_REQUIRED')
        return
      }
      if (attachment) {
        const { url } = await uploadBlob(apiBase, attachment)
        const caption = content || attachment.name
        await postTextMessage(apiBase, {
          type: 'file',
          content: caption,
          file_url: url,
          has_pin: usePin,
          pin: usePin ? pin : undefined,
        })
        setAttachment(null)
      } else {
        await postTextMessage(apiBase, {
          content,
          has_pin: usePin,
          pin: usePin ? pin : undefined,
        })
      }
      setText('')
      if (usePin) setPin('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SEND_FAILED')
    }
  }, [apiBase, text, usePin, pin, attachment])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const onUnlock = async (id: string) => {
    const p = window.prompt('PIN')
    if (p === null) return
    setError(null)
    try {
      const revealed = await unlockMessage(apiBase, id, p)
      upsert(revealed)
    } catch {
      setError('UNLOCK_FAILED')
    }
  }

  const refresh = async () => {
    setError(null)
    try {
      const list = await fetchMessages(apiBase)
      mergeFromServer(list)
    } catch {
      setError('REFRESH_FAILED')
    }
  }

  return (
    <div className="app">
      <header className="bar">
        <span className="title">Message Drop</span>
        <span className={`conn conn-${conn}`}>{conn}</span>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {error ? <div className="err">{error}</div> : null}

      <main className="main">
        <ul className="list">
          {messages.map((m) => (
            <li key={m.id} className="row">
              <div className="meta">
                <time dateTime={new Date(m.timestamp).toISOString()}>
                  {new Date(m.timestamp).toLocaleString()}
                </time>
                {m.type === 'file' ? <span className="tag">file</span> : null}
              </div>
              <div className="body">
                {m.file_url ? (
                  <a
                    className="file-link"
                    href={`${apiBase}${m.file_url}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                ) : null}
                {m.has_pin && m.content === '' ? (
                  <span className="locked">Locked</span>
                ) : (
                  <span>{m.content}</span>
                )}
                {m.has_pin && m.content === '' ? (
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => void onUnlock(m.id)}
                  >
                    Unlock
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </main>

      <footer className="composer">
        <label className="file-pick">
          <span className="sr-only">Attach file</span>
          <input
            type="file"
            onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          />
        </label>
        {attachment ? (
          <span className="attach-name">{attachment.name}</span>
        ) : null}
        <input
          ref={inputRef}
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message…"
          autoComplete="off"
          aria-label="Message text"
        />
        <label className="pin-toggle">
          <input
            type="checkbox"
            checked={usePin}
            onChange={(e) => setUsePin(e.target.checked)}
          />
          PIN
        </label>
        {usePin ? (
          <input
            className="field pin"
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            autoComplete="off"
          />
        ) : null}
        <button type="button" className="send" onClick={() => void send()}>
          Send
        </button>
      </footer>
    </div>
  )
}
