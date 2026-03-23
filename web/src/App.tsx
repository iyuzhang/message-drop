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

type AttachmentKind = 'file' | 'image'

export default function App() {
  const apiBase = getApiBase()
  const { messages, conn, mergeFromServer, upsert } = useMessagePool(apiBase)
  const [text, setText] = useState('')
  const [usePin, setUsePin] = useState(false)
  const [pin, setPin] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentKind, setAttachmentKind] = useState<AttachmentKind | null>(
    null,
  )
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const applyViewport = () => {
      const vh = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-vh', `${Math.round(vh)}px`)
    }
    applyViewport()
    window.visualViewport?.addEventListener('resize', applyViewport)
    window.addEventListener('resize', applyViewport)
    return () => {
      window.visualViewport?.removeEventListener('resize', applyViewport)
      window.removeEventListener('resize', applyViewport)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  const clearAttachment = useCallback(() => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl)
    }
    setImagePreviewUrl(null)
    setAttachment(null)
    setAttachmentKind(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
  }, [imagePreviewUrl])

  const onSelectAttachment = useCallback(
    (file: File | null, kind: AttachmentKind) => {
      if (!file) return
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
      setAttachment(file)
      setAttachmentKind(kind)
      if (kind === 'image') {
        setImagePreviewUrl(URL.createObjectURL(file))
      } else {
        setImagePreviewUrl(null)
      }
    },
    [imagePreviewUrl],
  )

  const send = useCallback(async () => {
    const content = text.trim()
    if (!content && !attachment) return
    setError(null)
    setSending(true)
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
        clearAttachment()
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
    } finally {
      setSending(false)
    }
  }, [apiBase, text, usePin, pin, attachment, clearAttachment])

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
        <input
          ref={imageInputRef}
          className="hidden-input"
          type="file"
          accept="image/*"
          onChange={(e) =>
            onSelectAttachment(e.target.files?.[0] ?? null, 'image')
          }
        />
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          onChange={(e) =>
            onSelectAttachment(e.target.files?.[0] ?? null, 'file')
          }
        />

        <button
          type="button"
          className="ghost"
          onClick={() => imageInputRef.current?.click()}
        >
          图片
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => fileInputRef.current?.click()}
        >
          文件
        </button>
        {attachment ? (
          <button type="button" className="ghost small" onClick={clearAttachment}>
            清除
          </button>
        ) : null}

        {attachment ? (
          <span className="attach-name">
            {attachmentKind === 'image' ? '图片' : '文件'}: {attachment.name}
          </span>
        ) : null}
        {imagePreviewUrl ? (
          <img className="attach-preview" src={imagePreviewUrl} alt="preview" />
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
        <button
          type="button"
          className="send"
          onClick={() => void send()}
          disabled={sending}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </footer>
    </div>
  )
}
