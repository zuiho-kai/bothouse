/**
 * #1023 交付卡放能点的网页: when a hand-back (a task's result message) delivers a web page —
 * an uploaded .html file or an http(s) link — the card shows the page itself in a sandboxed
 * frame, with 全屏, 继续改 and 收下 beside it, so the owner does not download and reopen it.
 * Any other delivery keeps the plain card.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChannelAttachment, ChannelMessage, ChannelTask } from './channel-source.ts'
import { attachmentUrl } from './channel-source.ts'
import { EmbedFrame } from './EmbedPage.tsx'
import type { T } from './task-board.ts'
import css from './ChannelsPage.module.css'
import { getScheme } from './scheme.ts'

/** True for an uploaded web page (by type or by name). */
export const isHtmlAttachment = (a: ChannelAttachment): boolean =>
  /^text\/html\b/i.test(a.mime) || /\.html?$/i.test(a.name)

/** First http(s) URL in a message, markdown link or bare; undefined when there is none. */
export function firstWebLink(text: string): string | undefined {
  const match = /https?:\/\/[^\s<>()\]"'`]+/i.exec(text)
  return match?.[0].replace(/[.,;:!?。，；：！？]+$/, '')
}

export interface Deliverable {
  readonly src: string
  readonly title: string
  /** A page served from this origin (an upload) must not get the shell's origin. */
  readonly sameOrigin: boolean
}

/** The web page this message delivers: an .html upload first, else the first link. */
export function deliverableOf(message: ChannelMessage): Deliverable | undefined {
  const page = message.attachments?.find(isHtmlAttachment)
  if (page !== undefined) return { src: `${attachmentUrl(page.id)}?view=page`, title: page.name, sameOrigin: true }
  const link = firstWebLink(message.text)
  if (link === undefined) return undefined
  let sameOrigin = false
  try { sameOrigin = new URL(link, document.baseURI).origin === window.location.origin } catch { return undefined }
  return { src: link, title: link, sameOrigin }
}

/** Tasks this message was handed back for (TaskBoard result_msg_id). */
export const deliveredTasks = (message: ChannelMessage, tasks: readonly ChannelTask[]): ChannelTask[] =>
  tasks.filter(task => task.result_msg_id === message.id)

export function DeliveryPreview({ page, task, t, onReview, onRevise }: {
  readonly page: Deliverable
  /** The returned task this page delivers; its 继续改/收下 show only while it waits for review. */
  readonly task: ChannelTask | undefined
  readonly t: T
  readonly onReview?: (id: number, verdict: 'done' | 'rework', note?: string) => Promise<void>
  /** 继续改: reply to the delivery so the change request reaches its author. */
  readonly onRevise: () => void
}) {
  const [full, setFull] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (full) closeRef.current?.focus() }, [full])
  const waiting = task !== undefined && task.status === 'returned' && onReview !== undefined
  const accept = (): void => {
    if (task === undefined || onReview === undefined || state === 'saving') return
    setState('saving')
    onReview(task.id, 'done').then(() => { setState('idle') }, () => { setState('error') })
  }
  const actions = (inDialog: boolean) => (
    <div className={css.deliveryActions}>
      {!inDialog && <button type="button" className={css.secondaryButton} onClick={() => { setFull(true) }}>{t('deliveryFull')}</button>}
      {waiting && <button type="button" className={css.secondaryButton} onClick={() => { setFull(false); onRevise() }}>{t('deliveryRevise')}</button>}
      {waiting && <button type="button" className={css.primaryButton} disabled={state === 'saving'} onClick={accept}>{t('deliveryAccept')}</button>}
      {task?.status === 'done' && <span className={css.deliveryDone}>{t('deliveryAccepted')}</span>}
      {state === 'error' && <span className={css.sendError} role="alert">{t('deliveryAcceptFailed')}</span>}
    </div>
  )
  return (
    <div className={css.delivery} data-delivery-preview>
      <div className={css.deliveryFrame}>
        <EmbedFrame src={page.src} title={page.title} sandboxed sameOrigin={page.sameOrigin} />
      </div>
      {actions(false)}
      {full && createPortal(
        <div className={css.dialogBackdrop} data-dc-scheme={getScheme()} onClick={event => { if (event.target === event.currentTarget) setFull(false) }}>
          <section className={`${css.dialog} ${css.deliveryFullDialog}`} role="dialog" aria-modal="true" aria-label={page.title}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFull(false) } }}>
            <div className={css.imagePreviewHeader}>
              <span>{page.title}</span>
              <button ref={closeRef} type="button" className={css.secondaryButton} aria-label={t('close')} onClick={() => { setFull(false) }}>×</button>
            </div>
            <div className={css.deliveryFullFrame}>
              <EmbedFrame src={page.src} title={page.title} sandboxed sameOrigin={page.sameOrigin} />
            </div>
            {actions(true)}
          </section>
        </div>, document.body,
      )}
    </div>
  )
}
