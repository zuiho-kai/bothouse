// #144: images and files in channel messages — the list shown under a message,
// and the composer's pending list (picked with the button, pasted, or dropped).
import { useRef, type ClipboardEvent, type DragEvent } from 'react'
import type { ChannelAttachment, OutgoingAttachment } from './channel-source.ts'
import { attachmentUrl, readAttachment } from './channel-source.ts'
import css from './ChannelsPage.module.css'

const isImage = (mime: string): boolean => /^image\/(png|jpeg|gif|webp)$/.test(mime)
const isAudio = (mime: string): boolean => mime.startsWith('audio/')

const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Thumbnails for images, a download card for other files. */
export function AttachmentList({ attachments }: { readonly attachments?: readonly ChannelAttachment[] }) {
  if (attachments === undefined || attachments.length === 0) return null
  return (
    <div className={css.attachments}>
      {attachments.map(a => isImage(a.mime)
        ? (
            <a key={a.id} href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" title={a.name}>
              <img className={css.attachmentImage} src={attachmentUrl(a.id)} alt={a.name} loading="lazy" />
            </a>
          )
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
            📎
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
