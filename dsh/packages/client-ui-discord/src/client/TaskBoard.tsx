/**
 * Team mode B (#139): the task board beside the channel (who, what, status,
 * when it is next checked) and the task card shown for task records in the
 * message stream (one row per member: the task owner and its sub-tasks, each
 * with its elapsed time). Data comes from the snapshot's `tasks`.
 */
import type { ChannelRoom, ChannelTask, TaskStatus } from './channel-source.ts'
import { boardSections, cardMembers, elapsed, formatDuration, STATUS_KEY, type T } from './task-board.ts'
import css from './ChannelsPage.module.css'

function clock(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Status({ status, t }: { status: TaskStatus; t: T }) {
  return <span className={css.taskStatus} data-status={status}>{t(STATUS_KEY[status])}</span>
}

/**
 * Right-column board for the selected chat channel.
 * @param onOpen - jump to a message in a room (dispatch or delivery).
 */
export function TaskBoard({ tasks, rooms, chatId, roomId, t, onOpen }: {
  tasks: readonly ChannelTask[]
  rooms: readonly ChannelRoom[]
  chatId: number | undefined
  roomId: number | undefined
  t: T
  onOpen: (roomId: number, messageId: number) => void
}) {
  const now = Date.now() / 1000
  const sections = boardSections(tasks, rooms, chatId, roomId)
  const openTotal = sections.reduce((n, s) => n + s.open, 0)
  const all = sections.reduce((n, s) => n + s.open + s.done, 0)
  const row = (task: ChannelTask) => (
    <li key={task.id} className={css.taskRow} data-task-id={task.id}>
      <div className={css.taskLine}>
        <Status status={task.status} t={t} />
        <span className={css.taskTitle}>#{task.id} {task.title}</span>
      </div>
      <div className={css.taskMeta}>
        <span>{t('taskElapsed', { d: formatDuration(elapsed(task, now), t) })}</span>
        {task.next_check_at !== null && <span>{t('taskNextCheck', { time: clock(task.next_check_at) })}</span>}
      </div>
      <div className={css.taskLinks}>
        {task.assign_msg_id !== null && <button type="button" className={css.linkButton} onClick={() => { onOpen(task.room_id, task.assign_msg_id as number) }}>{t('taskOpenAssign')}</button>}
        {task.result_msg_id !== null && <button type="button" className={css.linkButton} onClick={() => { onOpen(task.room_id, task.result_msg_id as number) }}>{t('taskOpenResult')}</button>}
      </div>
    </li>
  )
  return (
    <section className={css.taskBoard} aria-label={t('taskBoard')}>
      <h3 className={css.groupTitle}>{t('taskBoardTitle', { count: String(openTotal) })}</h3>
      {all === 0 && <div className={css.taskEmpty}>{t('taskBoardEmpty')}</div>}
      {sections.map(section => (
        <div key={section.roomId} className={css.taskSection} data-room-id={section.roomId}>
          <h4 className={css.taskSectionTitle}>
            {section.chat ? t('taskBoardChat') : t('taskBoardWorkspace', { room: section.name })}
          </h4>
          {section.owners.map(group => (
            <div key={group.owner} className={css.taskOwnerGroup} data-owner={group.owner}>
              <div className={css.taskOwnerName}>{t('taskBoardOwner', { name: group.ownerName })}</div>
              <ul className={css.taskList}>{group.open.map(row)}</ul>
              {group.done.length > 0 && (
                <details className={css.taskDone}>
                  <summary className={css.groupTitle}>{t('taskDoneGroup', { count: String(group.done.length) })}</summary>
                  <ul className={css.taskList}>{group.done.map(row)}</ul>
                </details>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

/**
 * Card for a task record in the message stream: the task and one row per
 * member (owner of the task and of each sub-task) with status and elapsed time.
 * Renders nothing when the task is not on the loaded board.
 */
export function TaskCard({ taskId, tasks, t }: { taskId: number; tasks: readonly ChannelTask[]; t: T }) {
  const members = cardMembers(taskId, tasks)
  const task = members[0]
  if (task === undefined) return null
  const now = Date.now() / 1000
  return (
    <div className={css.taskCard} data-status={task.status}>
      <div className={css.taskLine}>
        <span className={css.cardTitle}>#{task.id} {task.title}</span>
        <Status status={task.status} t={t} />
      </div>
      <ul className={css.taskMembers}>
        {members.map(m => (
          <li key={m.id} className={css.taskMember}>
            <span className={css.taskMemberName}>{m.owner_name}</span>
            {m.id !== task.id && <span className={css.taskSub}>{m.title}</span>}
            <Status status={m.status} t={t} />
            <span className={css.taskMeta}>{formatDuration(elapsed(m, now), t)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
