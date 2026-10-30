// #144: images and files in channel messages — the list shown under a message,
// and the composer's pending list (picked with the button, pasted, or dropped).
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { ChannelAttachment, OutgoingAttachment } from './channel-source.ts'
import { attachmentUrl, readAttachment } from './channel-source.ts'
import css from './ChannelsPage.module.css'

const isImage = (mime: string): boolean => /^image\/(png|jpeg|gif|webp)$/.test(mime)
const isAudio = (mime: string): boolean => mime.startsWith('audio/')

const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

type T = TranslateNS<typeof NS>

function ImageAttachment({ attachment: a, t }: { readonly attachment: ChannelAttachment; readonly t: T }) {
  const [opened, setOpened] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!opened) return
    const origin = trigger.current
    closeButton.current?.focus()
    const containFocus = (event: FocusEvent): void => {
      if (!dialog.current?.contains(event.target as Node)) closeButton.current?.focus()
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      origin?.focus()
    }
  }, [opened])
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copyState])
  const copy = async (): Promise<void> => {
    if (copyState === 'copying') return
    setCopyState('copying')
    try {
      if (typeof navigator.clipboard?.write !== 'function' || typeof ClipboardItem === 'undefined') {
        setCopyState('error')
        return
      }
      const response = await fetch(attachmentUrl(a.id))
      if (!response.ok) throw new Error('Image download failed')
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }
  const copyLabel = t(copyState === 'copied' ? 'attachmentCopied' : copyState === 'copying' ? 'attachmentCopying' : 'attachmentCopy')
  // Both surfaces use the same controls, copy callback and feedback state.
  const actions = <>
    <a className={copyState === 'error' ? css.primaryButton : css.secondaryButton} href={attachmentUrl(a.id)} download={a.name} target="_blank" rel="noreferrer" aria-label={t('attachmentDownload')}>{t('attachmentDownload')}</a>
    <button type="button" className={css.secondaryButton} onClick={() => { void copy() }} disabled={copyState === 'copying'} aria-label={copyLabel} aria-live="polite">{copyLabel}</button>
  </>
  const error = copyState === 'error' && <div className={css.sendError} role="alert">{t('attachmentCopyError')}</div>
  return (
    <div className={css.imageAttachment} data-copy-state={copyState}>
      <button ref={trigger} type="button" className={css.imagePreviewTrigger} title={a.name} aria-haspopup="dialog" aria-expanded={opened} onClick={() => setOpened(true)}>
        <img className={css.attachmentImage} src={attachmentUrl(a.id)} alt={a.name} loading="lazy" />
      </button>
      <div className={css.attachmentActions}>{actions}</div>
      {!opened && error}
      {opened && createPortal(
        <div className={css.dialogBackdrop} onClick={event => { if (event.target === event.currentTarget) setOpened(false) }}>
          <section ref={dialog} className={`${css.dialog} ${css.imagePreviewDialog}`} role="dialog" aria-modal="true" aria-label={a.name} tabIndex={-1} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpened(false) }
            if (event.key === 'Tab') {
              const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
              const first = controls[0]
              const last = controls[controls.length - 1]
              if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
              else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
            }
          }}>
            <div className={css.imagePreviewHeader}>
              <span>{a.name}</span>
              <button ref={closeButton} type="button" className={css.secondaryButton} aria-label={t('close')} onClick={() => setOpened(false)}>×</button>
            </div>
            <img className={css.imagePreviewImage} src={attachmentUrl(a.id)} alt={a.name} />
            <div className={css.imagePreviewActions}>{actions}</div>
            {error}
          </section>
        </div>, document.body,
      )}
    </div>
  )
}

/** Thumbnails for images, a download card for other files. */
export function AttachmentList({ attachments, t }: { readonly attachments?: readonly ChannelAttachment[]; readonly t: T }) {
  if (attachments === undefined || attachments.length === 0) return null
  return (
    <div className={css.attachments}>
      {attachments.map(a => isImage(a.mime)
        ? <ImageAttachment key={a.id} attachment={a} t={t} />
        : isAudio(a.mime)
          ? (
              <div key={a.id} className={css.attachmentAudio}>
                <audio controls preload="metadata" src={attachmentUrl(a.id)} title={a.name} />
                <a className={css.attachmentSize} href={attachmentUrl(a.id)} download={a.name}>{a.name} · {size(a.size)}</a>
              </div>
            )
          : (
              <a key={a.id} className={css.attachmentFile} href={attachmentUrl(a.id)} download={a.name}>
                📎 {a.name} <span className={css.attachmentSize}>{size(a.size)}</span>
              </a>
            ))}
    </div>
  )
}

/** Files carried by a paste or drop event (empty when it is plain text). */
const eventFiles = (list: DataTransfer | null): File[] => (list === null ? [] : Array.from(list.files))

/**
 * Composer helpers: an attach button with its hidden file input, the pending
 * list with remove buttons, and paste/drop handlers for the textarea.
 */
export function useComposerAttachments(add: (files: OutgoingAttachment[]) => void, onError: (message: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const take = (files: File[]): void => {
    if (files.length === 0) return
    Promise.all(files.map(readAttachment)).then(add).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error))
    })
  }
  return {
    onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
      const files = eventFiles(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      take(files)
    },
    onDragOver(event: DragEvent<HTMLTextAreaElement>): void {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    },
    onDrop(event: DragEvent<HTMLTextAreaElement>): void {
      const files = eventFiles(event.dataTransfer)
      if (files.length === 0) return
      event.preventDefault()
      take(files)
    },
    button(label: string, disabled: boolean) {
      return (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              take(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <button type="button" className={css.mentionButton} title={label} aria-label={label} disabled={disabled} onClick={() => inputRef.current?.click()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </>
      )
    },
  }
}

/** Files waiting to be sent with the next message. */
export function PendingAttachments({ files, onRemove, removeLabel }: {
  readonly files: readonly OutgoingAttachment[]
  readonly onRemove: (index: number) => void
  readonly removeLabel: string
}) {
  if (files.length === 0) return null
  return (
    <div className={css.attachments}>
      {files.map((f, i) => (
        <span key={`${i}-${f.name}`} className={css.attachmentFile}>
          {isImage(f.mime) ? <img className={css.attachmentThumb} src={`data:${f.mime};base64,${f.data}`} alt={f.name} /> : '📎'} {f.name}
          <button type="button" className={css.replyCancel} title={removeLabel} aria-label={removeLabel} onClick={() => onRemove(i)}>×</button>
        </span>
      ))}
    </div>
  )
}
