import { useCallback, useEffect, useRef, useState } from 'react'
import {
  checkForAppUpdate,
  fetchMessages,
  getApiBase,
  postTextMessage,
  unlockMessage,
  uploadBlob,
} from './api'
import { useMessagePool } from './useMessagePool'
import type { AppUpdateInfo } from './types'
import './App.css'

type AttachmentKind = 'file' | 'image'

export default function App() {
  const apiBase = getApiBase()
  const isAndroidWebView = typeof window !== 'undefined' && !!window.MessageDropAndroid
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
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null)
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void checkForAppUpdate({ signal: ac.signal }).then((info) => {
      setAppUpdate(info)
    })
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const applyViewport = () => {
      const viewport = window.visualViewport
      const vh = viewport?.height ?? window.innerHeight
      const bottomInset = Math.max(
        0,
        window.innerHeight - vh - (viewport?.offsetTop ?? 0),
      )
      document.documentElement.style.setProperty('--app-vh', `${Math.round(vh)}px`)
      document.documentElement.style.setProperty(
        '--app-bottom-inset',
        `${Math.round(bottomInset)}px`,
      )
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
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
      }
      if (usePin) setPin('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SEND_FAILED')
    } finally {
      setSending(false)
    }
  }, [apiBase, text, usePin, pin, attachment, clearAttachment])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        <button
          type="button"
          className="ghost"
          onClick={() => void refresh()}
          aria-label="Refresh messages"
          style={{ border: 'none', background: 'var(--code-bg)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Refresh
        </button>
      </header>

      {appUpdate && !updateBannerDismissed ? (
        <div className="update-banner" role="status">
          <span>
            New release{' '}
            <strong>{appUpdate.latestTag}</strong> is available (you have{' '}
            {appUpdate.currentVersion}).
          </span>
          <a
            className="ghost small"
            href={appUpdate.htmlUrl}
            target="_blank"
            rel="noreferrer"
          >
            View release
          </a>
          <button
            type="button"
            className="ghost small"
            onClick={() => setUpdateBannerDismissed(true)}
            aria-label="Dismiss update notice"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? <div className="err">{error}</div> : null}

      <main className="main">
        {messages.length === 0 ? (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <p>No messages yet.</p>
            <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>Type a message or attach a file below to get started.</p>
          </div>
        ) : (
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
                {m.has_pin && m.content === '' ? (
                  <span className="locked">Locked</span>
                ) : (
                  <span>{m.content}</span>
                )}
                {m.file_url ? (
                  <a
                    className="file-link"
                    href={`${apiBase}${m.file_url}`}
                    target={isAndroidWebView ? undefined : '_blank'}
                    rel={isAndroidWebView ? undefined : 'noreferrer'}
                    download
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download
                  </a>
                ) : null}
                {m.has_pin && m.content === '' ? (
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => void onUnlock(m.id)}
                    aria-label="Unlock message"
                  >
                    Unlock
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        )}
      </main>

      <footer className="composer">
        <div
          className="composer-toolbar"
          role="group"
          aria-label="Attachments"
        >
          <input
            ref={imageInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            aria-hidden
            tabIndex={-1}
            onChange={(e) =>
              onSelectAttachment(e.target.files?.[0] ?? null, 'image')
            }
          />
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            aria-hidden
            tabIndex={-1}
            onChange={(e) =>
              onSelectAttachment(e.target.files?.[0] ?? null, 'file')
            }
          />

          <button
            type="button"
            className="ghost"
            onClick={() => imageInputRef.current?.click()}
            aria-label="Attach image"
            style={{ color: attachmentKind === 'image' ? 'var(--accent)' : undefined }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            Image
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            style={{ color: attachmentKind === 'file' ? 'var(--accent)' : undefined }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
            File
          </button>
        </div>

        {attachment ? (
          <div
            className="composer-attachment"
            role="status"
            aria-live="polite"
          >
            {imagePreviewUrl ? (
              <img
                className="attach-preview"
                src={imagePreviewUrl}
                alt="Selected image preview"
              />
            ) : null}
            <span className="attach-name">
              {attachmentKind === 'image' ? 'Image' : 'File'}: {attachment.name}
            </span>
            <button
              type="button"
              className="ghost small"
              onClick={clearAttachment}
              aria-label="Remove attachment"
            >
              Clear
            </button>
          </div>
        ) : null}

        <div className="composer-field-row">
          <textarea
            ref={inputRef}
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message…"
            autoComplete="off"
            aria-label="Message text"
            rows={1}
            style={{ minHeight: 'var(--touch-target-min)', maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
        </div>

        <div className="composer-actions">
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
              aria-label="Message PIN"
            />
          ) : null}
          <button
            type="button"
            className="send"
            onClick={() => void send()}
            disabled={sending}
            aria-busy={sending}
          >
            {sending ? 'Sending…' : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                Send
              </span>
            )}
          </button>
        </div>
      </footer>
    </div>
  )
}
