/**
 * 等你定 tray above the composer (#125, the owner's 11:53 sample v1 and the lead's reading of
 * 「直接回复那需要加个发送键吗」): questions members asked (tasks in `asked`, the question is the
 * task note) and pending permission requests stay pinned while the log scrolls, under one header
 * that folds them away. Each question takes a direct reply with a small ↑ send button (grey while
 * empty, Enter still sends) and a short undo window before the reply goes out.
 * The reply endpoint is not live yet (#107/#118): without `onAnswer` the button says so instead of
 * pretending the reply was delivered.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChannelTask } from './channel-source.ts'
import type { T } from './task-board.ts'
import css from './ChannelsPage.module.css'

// 来源：主角色 11-04 11:53 定案「发出后原地显示『已回复：xxx』并能撤回5秒」。
export const UNDO_SECONDS = 5

/** Questions waiting on the lead/user in these rooms, oldest first so the longest wait is on top. */
export function openQuestions(tasks: readonly ChannelTask[], rooms: ReadonlySet<number>): ChannelTask[] {
  return tasks.filter(task => task.status === 'asked' && task.paused_at == null && rooms.has(task.room_id)).sort((a, b) => a.updated_at - b.updated_at)
}

type Phase = { kind: 'draft' } | { kind: 'pending'; text: string; left: number } | { kind: 'sent'; text: string } | { kind: 'unavailable' }

function AskItem({ task, t, onAnswer, isImeEnter }: {
  task: ChannelTask
  t: T
  onAnswer: ((taskId: number, text: string) => Promise<void>) | undefined
  isImeEnter: (event: { nativeEvent: Event }) => boolean
}) {
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'draft' })
  const [error, setError] = useState<string>()
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  useEffect(() => () => { clearInterval(timer.current) }, [])

  const deliver = (text: string): void => {
    clearInterval(timer.current)
    setPhase({ kind: 'sent', text })
    onAnswer?.(task.id, text).catch((e: unknown) => {
      setPhase({ kind: 'draft' })
      setDraft(text)
      setError(e instanceof Error ? e.message : String(e))
    })
  }
  const send = (): void => {
    const text = draft.trim()
    if (text === '' || phase.kind === 'pending') return
    setError(undefined)
    if (onAnswer === undefined) { setPhase({ kind: 'unavailable' }); return }
    setDraft('')
    setPhase({ kind: 'pending', text, left: UNDO_SECONDS })
    let left = UNDO_SECONDS
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      left -= 1
      if (left <= 0) deliver(text)
      else setPhase({ kind: 'pending', text, left })
    }, 1000)
  }
  const undo = (): void => {
    if (phase.kind !== 'pending') return
    clearInterval(timer.current)
    setDraft(phase.text)
    setPhase({ kind: 'draft' })
  }

  let tail: ReactNode
  if (phase.kind === 'pending') {
    tail = <span className={css.askDone} role="status">{t('askReplied', { text: phase.text })}
      <button type="button" className={css.linkButton} onClick={undo}>{t('askUndo', { n: String(phase.left) })}</button>
    </span>
  } else if (phase.kind === 'sent') {
    tail = <span className={css.askDone} role="status">{t('askReplied', { text: phase.text })}</span>
  } else {
    tail = <form className={css.askForm} onSubmit={(event) => { event.preventDefault(); send() }}>
      <input
        className={css.askInput}
        value={draft}
        placeholder={t('askPlaceholder')}
        aria-label={t('askReplyTo', { id: String(task.id) })}
        onChange={(event) => { setDraft(event.target.value); if (phase.kind === 'unavailable') setPhase({ kind: 'draft' }) }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !isImeEnter(event)) { event.preventDefault(); send() } }}
      />
      <button type="submit" className={css.askSend} title={t('askSend')} aria-label={t('askSend')} disabled={draft.trim() === ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
      </button>
    </form>
  }
  return (
    <div className={css.askItem} data-task-id={task.id}>
      <span className={css.askKind}>{t('askKind')}</span>
      <div className={css.askText}>
        <span className={css.askQuestion}>{task.note?.trim() || t('askNoNote')}</span>
        <small className={css.askFrom}>{t('askFrom', { name: task.owner_name, id: String(task.id), title: task.title })}</small>
      </div>
      {tail}
      {phase.kind === 'unavailable' && <div className={css.askNotice} role="status">{t('askApiPending')}</div>}
      {error !== undefined && <div className={css.sendError} role="alert">{error}</div>}
    </div>
  )
}

/**
 * The folding tray. `permissions` is the existing permission list (rendered by the page), so
 * its buttons and server-driven states stay exactly as before; the tray only adds the header
 * and the questions. Renders nothing when neither waits.
 */
export function DecideTray({ questions, permissionCount, permissions, t, onAnswer, isImeEnter }: {
  questions: readonly ChannelTask[]
  permissionCount: number
  permissions: ReactNode
  t: T
  onAnswer?: (taskId: number, text: string) => Promise<void>
  isImeEnter: (event: { nativeEvent: Event }) => boolean
}) {
  const [open, setOpen] = useState(true)
  if (questions.length === 0 && permissionCount === 0) return null
  const head = [
    questions.length > 0 ? t('trayAsks', { count: String(questions.length) }) : '',
    permissionCount > 0 ? t('trayPerms', { count: String(permissionCount) }) : '',
  ].filter(Boolean).join(' · ')
  return (
    <section className={css.decideTray} role="region" aria-label={t('decideTray')} data-open={open}>
      <button type="button" className={css.decideTrayHead} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <strong>{head}</strong>
        <small>{t('trayPinned')}</small>
        <span className={css.decideTrayToggle}>{t(open ? 'trayCollapse' : 'trayExpand')}</span>
      </button>
      {open && <>
        {questions.length > 0 && <div className={css.askList}>
          {questions.map(task => <AskItem key={task.id} task={task} t={t} onAnswer={onAnswer} isImeEnter={isImeEnter} />)}
        </div>}
        {permissions}
      </>}
    </section>
  )
}
