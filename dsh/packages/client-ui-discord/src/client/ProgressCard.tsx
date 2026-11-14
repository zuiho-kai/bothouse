/**
 * 本频道进展 card at the top of the log (#125, the owner's 11:53 sample v1): four rows —
 * 做完 / 在做 / 下一步 / 没定 — summed up from this channel's tasks (the chat channel and its
 * workspaces), so it only says what the task board knows. Each row names the newest task in it
 * and jumps to that task's dispatch message when clicked.
 * - 做完: tasks accepted (done).
 * - 在做: live work on the owner's side (board group 在做: assigned/accepted/rework, not parked).
 * - 下一步: the next move the board can name — a hand-back waiting to be accepted (returned),
 *   else a parked task to resume.
 * - 没定: a question or a 退/升 stance waiting on the lead/user (asked, declined, escalated).
 * A row with nothing in it is not shown (#1017).
 * #156 (the owner's 10:0x「Channel progress 要能收起啊」): the card folds to one strip and the
 * choice is remembered per room, so a reload does not push it back open over the log.
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

/** Folded state of the card, remembered per room in the browser (#156). Same shape as the card view switch. */
const FOLD_KEY = 'dsh-channels-progress-folded:'

/**
 * #1616 (Fable #37–38: the open card covered the top of the log and cut its titles to a few
 * characters): folded is the default, one strip with the counts; a room opened by hand stays open.
 */
export function loadProgressFolded(roomId: number): boolean {
  try { return globalThis.localStorage?.getItem(FOLD_KEY + roomId) !== '0' } catch (error) { void error; return true /* storage unavailable: stay folded */ }
}

export function saveProgressFolded(roomId: number, folded: boolean): void {
  try { globalThis.localStorage?.setItem(FOLD_KEY + roomId, folded ? '1' : '0') } catch (error) { void error /* storage unavailable: keep the choice in memory */ }
}

function lineText(line: ProgressLine, t: T): string {
  const task = line.task
  if (task === undefined) return t('progressNone')
  const base = line.row === 'next'
    ? t(task.status === 'returned' ? 'progressNextReview' : 'progressNextResume', { id: String(task.id), title: task.title, name: task.owner_name })
    : t('progressTask', { id: String(task.id), title: task.title, name: task.owner_name })
  return line.count > 1 ? `${base}${t('progressMore', { count: String(line.count - 1) })}` : base
}

export function ProgressCard({ lines, t, onOpen, folded, onToggle }: {
  lines: readonly ProgressLine[]
  t: T
  onOpen: (roomId: number, messageId: number) => void
  folded: boolean
  onToggle: () => void
}) {
  const shown = lines.filter(line => line.task !== undefined)
  if (shown.length === 0) return null
  // Folded, the strip still says how much is in each row (#156): the counts, not the task names.
  const summary = shown.map(line => `${t(LABEL[line.row])} ${line.count}`).join(' · ')
  const label = t(folded ? 'progressExpand' : 'progressFold')
  return (
    <section className={css.progressCard} data-folded={folded} role="region" aria-label={t('progressTitle')}>
      <div className={css.progressHead}>
        <strong className={css.progressTitle}>{t('progressTitle')}</strong>
        {folded && <span className={css.progressSummary} title={summary}>{summary}</span>}
        <button type="button" className={css.progressToggle} title={label} aria-label={label} aria-expanded={!folded} onClick={onToggle}>
          {/* #156 rework: a word plus a chevron, so the button reads as one at a glance. */}
          <span>{t(folded ? 'progressExpandShort' : 'progressFoldShort')}</span>
          <span aria-hidden="true" className={css.progressChevron}>{folded ? '▾' : '▴'}</span>
        </button>
      </div>
      {!folded && (
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
      )}
    </section>
  )
}
