/**
 * 本频道进展 card at the top of the log (#125, the owner's 11:53 sample v1): four rows —
 * 做完 / 在做 / 下一步 / 没定 — summed up from this channel's tasks (the chat channel and its
 * workspaces), so it only says what the task board knows. Each row names the newest task in it
 * and jumps to that task's dispatch message when clicked.
 * - 做完: tasks accepted (done).
 * - 在做: live work on the owner's side (board group 在做: assigned/accepted/rework, not parked).
 * - 下一步: the next move the board can name — a hand-back waiting to be accepted (returned),
 *   else a parked task to resume.
 * A row with nothing in it is not shown (#1017).
 * - 没定: a question or a 退/升 stance waiting on the lead/user (asked, declined, escalated).
 */
import type { ChannelTask } from './channel-source.ts'
import { boardGroupOf, type T } from './task-board.ts'
import css from './ChannelsPage.module.css'

export type ProgressRow = 'done' | 'doing' | 'next' | 'open'
export interface ProgressLine { readonly row: ProgressRow; readonly task?: ChannelTask; readonly count: number }

const newest = (tasks: readonly ChannelTask[]): ChannelTask | undefined =>
  tasks.reduce<ChannelTask | undefined>((best, task) => best === undefined || task.updated_at > best.updated_at ? task : best, undefined)

/** The four rows for the tasks of these rooms; empty when the channel has no task at all. */
export function channelProgress(tasks: readonly ChannelTask[], rooms: ReadonlySet<number>): ProgressLine[] {
  const mine = tasks.filter(task => rooms.has(task.room_id))
  if (mine.length === 0) return []
  const done = mine.filter(task => task.status === 'done')
  const doing = mine.filter(task => boardGroupOf(task) === 'working')
  const returned = mine.filter(task => task.status === 'returned')
  const next = returned.length > 0 ? returned : mine.filter(task => boardGroupOf(task) === 'parked')
  const open = mine.filter(task => task.status === 'asked' || task.status === 'declined' || task.status === 'escalated')
  return [
    { row: 'done', task: newest(done), count: done.length },
    { row: 'doing', task: newest(doing), count: doing.length },
    { row: 'next', task: newest(next), count: next.length },
    { row: 'open', task: newest(open), count: open.length },
  ]
}

const LABEL = { done: 'progressDone', doing: 'progressDoing', next: 'progressNext', open: 'progressOpen' } as const

function lineText(line: ProgressLine, t: T): string {
  const task = line.task
  if (task === undefined) return t('progressNone')
  const base = line.row === 'next'
    ? t(task.status === 'returned' ? 'progressNextReview' : 'progressNextResume', { id: String(task.id), title: task.title, name: task.owner_name })
    : t('progressTask', { id: String(task.id), title: task.title, name: task.owner_name })
  return line.count > 1 ? `${base}${t('progressMore', { count: String(line.count - 1) })}` : base
}

export function ProgressCard({ lines, t, onOpen }: {
  lines: readonly ProgressLine[]
  t: T
  onOpen: (roomId: number, messageId: number) => void
}) {
  const shown = lines.filter(line => line.task !== undefined)
  if (shown.length === 0) return null
  return (
    <section className={css.progressCard} role="region" aria-label={t('progressTitle')}>
      <strong className={css.progressTitle}>{t('progressTitle')}</strong>
      <dl className={css.progressRows}>
        {/* #1017: an empty row takes no room. */}
        {shown.map((line) => {
          const text = lineText(line, t)
          const target = line.task?.assign_msg_id
          return (
            <div key={line.row} className={css.progressRow} data-row={line.row} data-empty={line.task === undefined}>
              <dt>{t(LABEL[line.row])}</dt>
              <dd title={text}>
                {line.task !== undefined && target != null
                  ? <button type="button" className={css.progressLink} onClick={() => { onOpen(line.task!.room_id, target) }}>{text}</button>
                  : text}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
