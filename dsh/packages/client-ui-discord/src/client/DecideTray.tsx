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
/** One question's reply state. It lives in the tray, not the row, so folding the tray or the task
 * leaving `asked` mid-countdown neither drops the draft nor silently cancels a reply (#972 review). */
type Reply = { draft: string; phase: Phase; error?: string; task: ChannelTask }

function AskItem({ reply, t, onDraft, onSend, onUndo, isImeEnter }: {
  reply: Reply
  t: T
  onDraft: (text: string) => void
  onSend: () => void
  onUndo: () => void
  isImeEnter: (event: { nativeEvent: Event }) => boolean
}) {
  const { task, draft, phase, error } = reply
  let tail: ReactNode
  if (phase.kind === 'pending') {
    tail = <span className={css.askDone} role="status">{t('askReplied', { text: phase.text })}
      <button type="button" className={css.linkButton} onClick={onUndo}>{t('askUndo', { n: String(phase.left) })}</button>
    </span>
  } else if (phase.kind === 'sent') {
    tail = <span className={css.askDone} role="status">{t('askReplied', { text: phase.text })}</span>
  } else {
    tail = <form className={css.askForm} onSubmit={(event) => { event.preventDefault(); onSend() }}>
      <input
        className={css.askInput}
        value={draft}
        placeholder={t('askPlaceholder')}
        aria-label={t('askReplyTo', { id: String(task.id) })}
        onChange={(event) => { onDraft(event.target.value) }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !isImeEnter(event)) { event.preventDefault(); onSend() } }}
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

/** A reply keeps its row while it counts down or after it failed, even once the task left `asked`,
 * so the user can still undo it or see the error. Drafts and delivered replies of tasks no longer
 * asked are not shown. */
function inFlight(reply: Reply): boolean {
  return reply.phase.kind === 'pending' || reply.error !== undefined
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
  const [replies, setReplies] = useState<ReadonlyMap<number, Reply>>(new Map())
  const timers = useRef(new Map<number, ReturnType<typeof setInterval>>())
  // Latest props for the countdown callbacks, which outlive the render that started them.
  const answerRef = useRef(onAnswer)
  answerRef.current = onAnswer
  useEffect(() => () => { for (const id of timers.current.values()) clearInterval(id) }, [])

  const asked = new Map(questions.map(task => [task.id, task]))
  const patch = (taskId: number, change: (reply: Reply) => Reply | undefined): void => {
    setReplies(prev => {
      const known = prev.get(taskId)
      const task = asked.get(taskId) ?? known?.task
      if (task === undefined) return prev
      const next = new Map(prev)
      const changed = change(known ?? { draft: '', phase: { kind: 'draft' }, task })
      if (changed === undefined) next.delete(taskId)
      else next.set(taskId, changed)
      return next
    })
  }
  const stop = (taskId: number): void => {
    clearInterval(timers.current.get(taskId))
    timers.current.delete(taskId)
  }
  const deliver = (taskId: number, text: string): void => {
    stop(taskId)
    patch(taskId, r => ({ ...r, phase: { kind: 'sent', text } }))
    answerRef.current?.(taskId, text).catch((e: unknown) => {
      patch(taskId, r => ({ ...r, phase: { kind: 'draft' }, draft: text, error: e instanceof Error ? e.message : String(e) }))
    })
  }
  const send = (taskId: number): void => {
    const reply = replies.get(taskId)
    const text = (reply?.draft ?? '').trim()
    if (text === '' || reply?.phase.kind === 'pending') return
    if (onAnswer === undefined) { patch(taskId, r => ({ ...r, error: undefined, phase: { kind: 'unavailable' } })); return }
    patch(taskId, r => ({ ...r, draft: '', error: undefined, phase: { kind: 'pending', text, left: UNDO_SECONDS } }))
    let left = UNDO_SECONDS
    stop(taskId)
    timers.current.set(taskId, setInterval(() => {
      left -= 1
      if (left <= 0) deliver(taskId, text)
      else patch(taskId, r => ({ ...r, phase: { kind: 'pending', text, left } }))
    }, 1000))
  }
  const undo = (taskId: number): void => {
    stop(taskId)
    patch(taskId, r => r.phase.kind === 'pending' ? { ...r, draft: r.phase.text, phase: { kind: 'draft' } } : r)
  }
  const draftOf = (taskId: number, text: string): void => {
    patch(taskId, r => ({ ...r, draft: text, phase: r.phase.kind === 'unavailable' ? { kind: 'draft' } : r.phase }))
  }

  const rows: Reply[] = questions.map(task => {
    const known = replies.get(task.id)
    return known === undefined ? { draft: '', phase: { kind: 'draft' }, task } : { ...known, task }
  })
  for (const reply of replies.values()) {
    if (!asked.has(reply.task.id) && inFlight(reply)) rows.push(reply)
  }
  if (rows.length === 0 && permissionCount === 0) return null
  const head = [
    rows.length > 0 ? t('trayAsks', { count: String(rows.length) }) : '',
    permissionCount > 0 ? t('trayPerms', { count: String(permissionCount) }) : '',
  ].filter(Boolean).join(' · ')
  return (
    <section className={css.decideTray} role="region" aria-label={t('decideTray')} data-open={open}>
      <button type="button" className={css.decideTrayHead} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <strong>{head}</strong>
        <small>{t('trayPinned')}</small>
        <span className={css.decideTrayToggle}>{t(open ? 'trayCollapse' : 'trayExpand')}</span>
      </button>
      {/* Folded rows stay mounted (hidden), so a running countdown or a draft is not lost. */}
      <div hidden={!open}>
        {rows.length > 0 && <div className={css.askList}>
          {rows.map(reply => <AskItem key={reply.task.id} reply={reply} t={t}
            onDraft={(text) => { draftOf(reply.task.id, text) }}
            onSend={() => { send(reply.task.id) }}
            onUndo={() => { undo(reply.task.id) }}
            isImeEnter={isImeEnter} />)}
        </div>}
        {permissions}
      </div>
    </section>
  )
}
