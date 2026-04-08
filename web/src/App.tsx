import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  checkForAppUpdate,
  fetchAuthStatus,
  fetchMessages,
  getApiBase,
  loginWithPassword,
  postTextMessage,
  setupServerPassword,
  unlockMessage,
  uploadBlob,
} from './api'
import { useMessagePool } from './useMessagePool'
import type { AppUpdateInfo } from './types'
import './App.css'

type AttachmentKind = 'file' | 'image'

function hasDraggedFiles(event: React.DragEvent<HTMLElement>): boolean {
  return hasFileDataTransfer(event.dataTransfer)
}

function hasFileDataTransfer(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer === null) return false
  return Array.from(dataTransfer.types).includes('Files')
}

function inferAttachmentKind(file: File): AttachmentKind {
  return file.type.startsWith('image/') ? 'image' : 'file'
}

export default function App() {
  const apiBase = getApiBase()
  const isAndroidWebView = typeof window !== 'undefined' && !!window.MessageDropAndroid
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authManagedByEnv, setAuthManagedByEnv] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [authPasswordInput, setAuthPasswordInput] = useState('')
  const [authPrompt, setAuthPrompt] = useState<'none' | 'login' | 'setup'>('none')
  const [authBusy, setAuthBusy] = useState(false)
  const {
    messages,
    conn,
    mergeFromServer,
    upsert,
  } = useMessagePool(apiBase, authToken, authChecking || (authEnabled && authToken === null))
  const [text, setText] = useState('')
  const [usePin, setUsePin] = useState(false)
  const [pin, setPin] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentKind, setAttachmentKind] = useState<AttachmentKind | null>(
    null,
  )
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null)
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const tokenStorageKey = `message_drop_auth_token:${apiBase}`

  const persistToken = useCallback(
    (token: string | null) => {
      setAuthToken(token)
      if (token === null) {
        localStorage.removeItem(tokenStorageKey)
      } else {
        localStorage.setItem(tokenStorageKey, token)
      }
    },
    [tokenStorageKey],
  )

  useEffect(() => {
    const cached = localStorage.getItem(tokenStorageKey)
    if (cached !== null && cached !== '') {
      setAuthToken(cached)
    }
  }, [tokenStorageKey])

  useEffect(() => {
    const run = async () => {
      setAuthChecking(true)
      try {
        const s = await fetchAuthStatus(apiBase)
        setAuthEnabled(s.enabled)
        setAuthManagedByEnv(s.managed_by_env)
        if (s.enabled && authToken === null) {
          setAuthPrompt('login')
        } else {
          setAuthPrompt('none')
        }
      } catch {
        // Keep legacy behavior when auth status endpoint is unreachable.
        setAuthEnabled(false)
        setAuthManagedByEnv(false)
        setAuthPrompt('none')
      } finally {
        setAuthChecking(false)
      }
    }
    void run()
  }, [apiBase, authToken])

  const ensureAuthorized = useCallback((e: unknown): boolean => {
    if (e instanceof ApiError && e.status === 401) {
      persistToken(null)
      setAuthPrompt('login')
      setError('AUTH_REQUIRED')
      return true
    }
    return false
  }, [persistToken])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)

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
    const preventFileDropNavigation = (event: DragEvent) => {
      if (!hasFileDataTransfer(event.dataTransfer)) return
      event.preventDefault()
    }
    window.addEventListener('dragover', preventFileDropNavigation)
    window.addEventListener('drop', preventFileDropNavigation)
    return () => {
      window.removeEventListener('dragover', preventFileDropNavigation)
      window.removeEventListener('drop', preventFileDropNavigation)
    }
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

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = event.message || 'UNCAUGHT_ERROR'
      setFatalError(msg)
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'UNHANDLED_REJECTION'
      setFatalError(msg)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

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
        const { url } = await uploadBlob(apiBase, authToken, attachment)
        const caption = content || attachment.name
        await postTextMessage(apiBase, authToken, {
          type: 'file',
          content: caption,
          file_url: url,
          has_pin: usePin,
          pin: usePin ? pin : undefined,
        })
        clearAttachment()
      } else {
        await postTextMessage(apiBase, authToken, {
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
      if (ensureAuthorized(e)) return
      setError(e instanceof Error ? e.message : 'SEND_FAILED')
    } finally {
      setSending(false)
    }
  }, [apiBase, text, usePin, pin, attachment, clearAttachment, authToken, ensureAuthorized])

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
      const revealed = await unlockMessage(apiBase, authToken, id, p)
      upsert(revealed)
    } catch (e) {
      if (ensureAuthorized(e)) return
      setError('UNLOCK_FAILED')
    }
  }

  const refresh = async () => {
    setError(null)
    try {
      const list = await fetchMessages(apiBase, authToken)
      mergeFromServer(list)
    } catch (e) {
      if (ensureAuthorized(e)) return
      setError('REFRESH_FAILED')
    }
  }

  const submitAuth = useCallback(async () => {
    const password = authPasswordInput.trim()
    if (authPrompt === 'setup' && password.length < 4) {
      setError('PASSWORD_TOO_SHORT')
      return
    }
    setAuthBusy(true)
    setError(null)
    try {
      if (authPrompt === 'setup') {
        const result = await setupServerPassword(apiBase, password)
        persistToken(result.token)
        setAuthEnabled(true)
        setAuthPrompt('none')
      } else {
        const result = await loginWithPassword(apiBase, password)
        persistToken(result.token)
        setAuthPrompt('none')
      }
      setAuthPasswordInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AUTH_FAILED')
    } finally {
      setAuthBusy(false)
    }
  }, [authPasswordInput, authPrompt, apiBase, persistToken])

  const onComposerDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDraggingFile(true)
  }, [])

  const onComposerDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onComposerDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setDraggingFile(false)
    }
  }, [])

  const onComposerDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(e)) return
      e.preventDefault()
      dragDepthRef.current = 0
      setDraggingFile(false)
      const file = e.dataTransfer.files?.[0] ?? null
      if (!file) return
      onSelectAttachment(file, inferAttachmentKind(file))
    },
    [onSelectAttachment],
  )

  if (fatalError) {
    return (
      <div className="app">
        <header className="bar">
          <span className="title">Message Drop</span>
          <span className="conn conn-offline">offline</span>
        </header>
        <main className="main">
          <div className="empty-state">
            <p>App rendering failed.</p>
            <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>
              {fatalError}
            </p>
            <button
              type="button"
              className="ghost"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="bar">
        <span className="title">Message Drop</span>
        <span className={`conn conn-${conn}`}>{conn}</span>
        {!authEnabled ? (
          <button
            type="button"
            className="ghost"
            onClick={() => setAuthPrompt('setup')}
            style={{ border: 'none', background: 'var(--code-bg)' }}
          >
            Set Password
          </button>
        ) : null}
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

      {authPrompt !== 'none' ? (
        <div className="err" role="alert" style={{ display: 'grid', gap: '8px' }}>
          <strong>{authPrompt === 'setup' ? 'Set server password' : 'Enter connection password'}</strong>
          {authManagedByEnv && authPrompt === 'setup' ? (
            <span>Password is managed by server environment variable.</span>
          ) : (
            <>
              <input
                className="field"
                type="password"
                value={authPasswordInput}
                onChange={(e) => setAuthPasswordInput(e.target.value)}
                placeholder="Connection password"
                autoComplete="off"
              />
              <button
                type="button"
                className="send"
                onClick={() => void submitAuth()}
                disabled={authBusy}
              >
                {authBusy ? 'Please wait…' : authPrompt === 'setup' ? 'Enable Password' : 'Connect'}
              </button>
            </>
          )}
        </div>
      ) : null}

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

      <footer
        className={`composer${draggingFile ? ' composer-drop-active' : ''}`}
        onDragEnter={onComposerDragEnter}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
      >
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

        {draggingFile ? (
          <div className="composer-drop-hint" role="status" aria-live="polite">
            Drop file here to attach
          </div>
        ) : null}

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
