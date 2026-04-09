import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  ApiError,
  checkForAppUpdate,
  consumeQrTicket,
  createQrTicket,
  fetchAuthStatus,
  fetchServerEntrypoints,
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
interface AttachmentItem {
  id: string
  file: File
  kind: AttachmentKind
  imagePreviewUrl: string | null
}

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
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [sending, setSending] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null)
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [qrTargetUrl, setQrTargetUrl] = useState<string>('')
  const [qrError, setQrError] = useState<string | null>(null)
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
      const ticket = new URLSearchParams(window.location.search).get('qr_ticket')
      if (ticket === null || ticket === '') return
      try {
        const result = await consumeQrTicket(apiBase, ticket)
        persistToken(result.token)
        const current = new URL(window.location.href)
        current.searchParams.delete('qr_ticket')
        const nextSearch = current.searchParams.toString()
        const nextUrl = `${current.pathname}${nextSearch === '' ? '' : `?${nextSearch}`}${current.hash}`
        window.history.replaceState({}, '', nextUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'QR_TICKET_CONSUME_FAILED')
      }
    }
    void run()
  }, [apiBase, persistToken])

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

  const buildDownloadHref = useCallback((fileUrl: string): string => {
    if (authToken === null || authToken === '') return fileUrl
    const base = apiBase.endsWith('/') ? apiBase : `${apiBase}/`
    const u = new URL(fileUrl, base)
    u.searchParams.set('token', authToken)
    return `${u.pathname}${u.search}${u.hash}`
  }, [apiBase, authToken])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const messageViewportRef = useRef<HTMLElement>(null)
  const latestMessageAnchorRef = useRef<HTMLDivElement>(null)
  const lastAutoScrollCountRef = useRef(0)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (authPrompt !== 'none') return
    const shouldAutoScroll =
      messages.length > lastAutoScrollCountRef.current || lastAutoScrollCountRef.current === 0
    lastAutoScrollCountRef.current = messages.length
    if (!shouldAutoScroll) return
    const id = window.requestAnimationFrame(() => {
      if (messageViewportRef.current === null) return
      latestMessageAnchorRef.current?.scrollIntoView({
        block: 'end',
      })
    })
    return () => window.cancelAnimationFrame(id)
  }, [messages, authPrompt])

  useEffect(() => {
    if (authPrompt !== 'none') {
      lastAutoScrollCountRef.current = 0
    }
  }, [authPrompt])

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
      for (const item of attachments) {
        if (item.imagePreviewUrl) {
          URL.revokeObjectURL(item.imagePreviewUrl)
        }
      }
    }
  }, [attachments])

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

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.imagePreviewUrl) {
          URL.revokeObjectURL(item.imagePreviewUrl)
        }
      }
      return []
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target?.imagePreviewUrl) {
        URL.revokeObjectURL(target.imagePreviewUrl)
      }
      return prev.filter((item) => item.id !== id)
    })
  }, [])

  const onSelectAttachments = useCallback(
    (files: FileList | null, kindHint?: AttachmentKind) => {
      if (files === null) return
      const picked = Array.from(files)
      if (picked.length === 0) return
      setAttachments((prev) => [
        ...prev,
        ...picked.map((file) => {
          const kind = kindHint ?? inferAttachmentKind(file)
          return {
            id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 8)}`,
            file,
            kind,
            imagePreviewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
          }
        }),
      ])
    },
    [],
  )

  const send = useCallback(async () => {
    const content = text.trim()
    if (!content && attachments.length === 0) return
    setError(null)
    setSending(true)
    try {
      if (usePin && !pin) {
        setError('PIN_REQUIRED')
        return
      }
      if (attachments.length > 0) {
        for (const item of attachments) {
          const { url } = await uploadBlob(apiBase, authToken, item.file)
          const caption =
            attachments.length === 1 && content !== ''
              ? content
              : item.file.name
          await postTextMessage(apiBase, authToken, {
            type: 'file',
            content: caption,
            file_url: url,
            has_pin: usePin,
            pin: usePin ? pin : undefined,
          })
        }
        clearAttachments()
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
  }, [apiBase, text, usePin, pin, attachments, clearAttachments, authToken, ensureAuthorized])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const onUnlock = async (id: string) => {
    const p = window.prompt('Enter passcode for this protected message')
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

  const openQrDialog = useCallback(async () => {
    setQrOpen(true)
    setQrBusy(true)
    setQrError(null)
    setQrImageUrl(null)
    setQrTargetUrl('')
    try {
      const entrypoints = await fetchServerEntrypoints(apiBase, authToken)
      let target = entrypoints.preferred_url || entrypoints.current_url || window.location.origin
      if (authEnabled) {
        const ticketResult = await createQrTicket(apiBase)
        const withTicket = new URL(target)
        withTicket.searchParams.set('qr_ticket', ticketResult.ticket)
        target = withTicket.toString()
      }
      const image = await QRCode.toDataURL(target, {
        width: 280,
        margin: 1,
      })
      setQrTargetUrl(target)
      setQrImageUrl(image)
    } catch (e) {
      if (ensureAuthorized(e)) {
        setQrOpen(false)
        return
      }
      const fallback = window.location.origin
      try {
        const image = await QRCode.toDataURL(fallback, {
          width: 280,
          margin: 1,
        })
        setQrTargetUrl(fallback)
        setQrImageUrl(image)
      } catch {
        setQrError(e instanceof Error ? e.message : 'QR_GENERATE_FAILED')
      }
    } finally {
      setQrBusy(false)
    }
  }, [apiBase, authToken, authEnabled, ensureAuthorized])

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
      onSelectAttachments(e.dataTransfer.files)
    },
    [onSelectAttachments],
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
        <button
          type="button"
          className="ghost"
          onClick={() => void openQrDialog()}
          aria-label="Show QR code for mobile browser"
          style={{ border: 'none', background: 'var(--code-bg)' }}
        >
          QR
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

      {authPrompt !== 'none' ? (
        <main className="main">
          <div className="auth-gate" role="alert">
            <h3>{authPrompt === 'setup' ? 'Set server password' : 'Enter connection password'}</h3>
            <p className="auth-gate-hint">
              {authPrompt === 'setup'
                ? 'Set once, then phone scan can auto-login.'
                : 'Login first to continue sending and viewing messages.'}
            </p>
            {authManagedByEnv && authPrompt === 'setup' ? (
              <p className="auth-gate-hint">
                Password is managed by `MESSAGE_DROP_SERVER_PASSWORD`.
              </p>
            ) : (
              <>
                <input
                  className="field"
                  type="password"
                  value={authPasswordInput}
                  onChange={(e) => setAuthPasswordInput(e.target.value)}
                  placeholder="Connection password"
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void submitAuth()
                    }
                  }}
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
            {error ? <div className="err">{error}</div> : null}
          </div>
        </main>
      ) : null}

      {authPrompt === 'none' ? (
      <>
      {error ? <div className="err">{error}</div> : null}

      <main className="main" ref={messageViewportRef}>
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
                  <span className="locked">Protected message</span>
                ) : (
                  <span>{m.content}</span>
                )}
                {m.file_url ? (
                  <a
                    className="file-link"
                    href={buildDownloadHref(m.file_url)}
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
        <div ref={latestMessageAnchorRef} aria-hidden className="list-end-anchor" />
      </main>
      </>
      ) : null}

      {qrOpen ? (
        <div
          className="qr-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile access QR"
          onClick={() => setQrOpen(false)}
        >
          <div className="qr-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Scan to open on phone</h3>
            <p className="qr-sub">Keep phone and server on the same LAN.</p>
            {qrBusy ? <p className="qr-sub">Generating QR…</p> : null}
            {!qrBusy && qrImageUrl ? (
              <img className="qr-image" src={qrImageUrl} alt="LAN Web UI QR code" />
            ) : null}
            {!qrBusy && qrTargetUrl ? (
              <p className="qr-url">{qrTargetUrl}</p>
            ) : null}
            {qrError ? <p className="qr-error">{qrError}</p> : null}
            <div className="qr-actions">
              <button type="button" className="ghost" onClick={() => setQrOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {authPrompt === 'none' ? (
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
            multiple
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              onSelectAttachments(e.target.files, 'image')
              if (imageInputRef.current) imageInputRef.current.value = ''
            }}
          />
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            multiple
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              onSelectAttachments(e.target.files, 'file')
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />

          <button
            type="button"
            className="ghost"
            onClick={() => imageInputRef.current?.click()}
            aria-label="Attach image"
            style={{
              color: attachments.some((item) => item.kind === 'image')
                ? 'var(--accent)'
                : undefined,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            Image
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            style={{
              color: attachments.some((item) => item.kind === 'file')
                ? 'var(--accent)'
                : undefined,
            }}
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

        {attachments.length > 0 ? (
          <div className="composer-attachments" role="status" aria-live="polite">
            {attachments.map((item) => (
              <div key={item.id} className="composer-attachment">
                {item.imagePreviewUrl ? (
                  <img
                    className="attach-preview"
                    src={item.imagePreviewUrl}
                    alt="Selected image preview"
                  />
                ) : null}
                <span className="attach-name">
                  {item.kind === 'image' ? 'Image' : 'File'}: {item.file.name}
                </span>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => removeAttachment(item.id)}
                  aria-label="Remove attachment"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ghost small"
              onClick={clearAttachments}
              aria-label="Clear all attachments"
            >
              Clear all
            </button>
          </div>
        ) : null}

        <div className={`composer-field-row${usePin ? ' protected' : ''}`}>
          {usePin ? (
            <span className="composer-field-lock-icon" aria-hidden>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="10" rx="2" ry="2" />
                <path d="M7 11V8a5 5 0 0 1 10 0v3" />
              </svg>
            </span>
          ) : null}
          <textarea
            ref={inputRef}
            className={`field${usePin ? ' protected' : ''}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={usePin ? 'Type a protected message…' : 'Type a message…'}
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
            Protected message
          </label>
          {usePin ? (
            <div className="pin-input-wrap">
              <span className="pin-lock-icon" aria-hidden>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="10" rx="2" ry="2" />
                  <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                </svg>
              </span>
              <input
                className="field pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter passcode"
                autoComplete="off"
                aria-label="Protected message passcode"
              />
            </div>
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
      ) : null}
    </div>
  )
}
