/**
 * Team mode B (#139): the task board beside the channel (who, what, status,
 * when it is next checked) and the task card shown for task records in the
 * message stream (one row per member: the task owner and its sub-tasks, each
 * with its elapsed time). Data comes from the snapshot's `tasks`.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { ChannelRoom, ChannelTask, TaskStatus } from './channel-source.ts'
import { BOARD_TABS, boardSections, cardMembers, sectionTitle, elapsed, formatDuration, STATUS_KEY, type T } from './task-board.ts'
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
  const [opened, setOpened] = useState(false)
  const [selectedTab, setSelectedTab] = useState(BOARD_TABS.find(tab => tab.initial)!.id)
  const dialog = useRef<HTMLElement>(null)
  const titleId = useId()
  const tabId = useId()
  const now = Date.now() / 1000
  const sections = boardSections(tasks, rooms, chatId, roomId)
  const roomName = rooms.find(room => room.id === roomId)?.name ?? rooms.find(room => room.id === chatId)?.name ?? ''
  const channelTotal = sections.filter(section => section.chat).reduce((n, section) => n + section.open + section.done, 0)
  const workspaceTotal = sections.filter(section => !section.chat).reduce((n, section) => n + section.open + section.done, 0)
  const close = () => { setOpened(false) }
  useEffect(() => { setOpened(false) }, [roomId])
  useEffect(() => {
    if (!opened) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { previous?.focus() }
  }, [opened])
  const jump = (targetRoomId: number, messageId: number) => {
    flushSync(close)
    onOpen(targetRoomId, messageId)
  }
  const openTotal = sections.reduce((n, s) => n + s.open, 0)
  const all = sections.reduce((n, s) => n + s.open + s.done, 0)
  const scopedTasks = sections.flatMap(section => section.owners.flatMap(group => [...group.open, ...group.done]))
  const activeTab = BOARD_TABS.find(tab => tab.id === selectedTab)!
  const matches = (task: ChannelTask) => activeTab.statuses.length === 0 || activeTab.statuses.includes(task.status)
  const visibleCount = scopedTasks.filter(matches).length
  const row = (task: ChannelTask) => (
    <li key={task.id} className={css.boardTaskCard} data-task-id={task.id} data-status={task.status} data-working={BOARD_TABS.find(tab => tab.initial)!.statuses.includes(task.status)}>
      <div className={css.boardTaskHeader}>
        <span className={css.boardTaskTitle}>#{task.id} {task.title}</span>
        <Status status={task.status} t={t} />
      </div>
      <div className={css.taskMeta}>
        <span>{task.owner_name}</span>
        <span>{t('taskElapsed', { d: formatDuration(elapsed(task, now), t) })}</span>
        {task.next_check_at !== null && <span>{t('taskNextCheck', { time: clock(task.next_check_at) })}</span>}
      </div>
      <div className={css.taskLinks}>
        {task.assign_msg_id !== null && <button type="button" className={css.linkButton} onClick={() => { jump(task.room_id, task.assign_msg_id as number) }}>{t('taskOpenAssign')}</button>}
        {task.result_msg_id !== null && <button type="button" className={css.linkButton} onClick={() => { jump(task.room_id, task.result_msg_id as number) }}>{t('taskOpenResult')}</button>}
      </div>
    </li>
  )
  return (
    <>
      <button type="button" className={css.taskBoardTrigger} aria-label={t('taskBoardOpen')} aria-haspopup="dialog" aria-expanded={opened} onClick={() => { setSelectedTab(BOARD_TABS.find(tab => tab.initial)!.id); setOpened(true) }}>
        <span>{t('taskBoard')}</span>
        <span className={css.taskBoardSummary}>{all === 0 ? t('taskBoardNoTasks') : t('taskBoardSummary', { open: String(openTotal), done: String(all - openTotal) })}</span>
        <span aria-hidden="true">›</span>
      </button>
      {opened && createPortal(<div className={css.dialogBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
        <section ref={dialog} className={`${css.dialog} ${css.taskBoardDialog}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); close() }
          if (event.key === 'Tab') {
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), [role="tabpanel"]'))
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
          }
        }}>
          <h2 id={titleId} className={css.dialogTitle}>{t('taskBoard')} · {roomName}</h2>
          <div className={css.taskBoardScope}>{t('taskBoardScope', { room: rooms.find(room => room.id === chatId)?.name ?? roomName, channel: String(channelTotal), workspaces: String(workspaceTotal) })}</div>
          <div className={css.boardTabs} role="tablist" aria-label={t('taskTabLabel')}>
            {BOARD_TABS.map((tab, index) => (
              <button key={tab.id} id={`${tabId}-${tab.id}`} type="button" role="tab" aria-selected={selectedTab === tab.id} aria-controls={`${tabId}-panel`} tabIndex={selectedTab === tab.id ? 0 : -1} onClick={() => { setSelectedTab(tab.id) }} onKeyDown={event => {
                let next = index
                if (event.key === 'ArrowRight') next = (index + 1) % BOARD_TABS.length
                else if (event.key === 'ArrowLeft') next = (index + BOARD_TABS.length - 1) % BOARD_TABS.length
                else if (event.key === 'Home') next = 0
                else if (event.key === 'End') next = BOARD_TABS.length - 1
                else return
                event.preventDefault()
                setSelectedTab(BOARD_TABS[next].id)
                document.getElementById(`${tabId}-${BOARD_TABS[next].id}`)?.focus()
              }}>
                {t(tab.label)} <span className={css.boardTabCount}>{scopedTasks.filter(task => tab.statuses.length === 0 || tab.statuses.includes(task.status)).length}</span>
              </button>
            ))}
          </div>
          <div id={`${tabId}-panel`} className={css.taskBoardBody} role="tabpanel" aria-labelledby={`${tabId}-${selectedTab}`} tabIndex={0}>
            {visibleCount === 0 && <div className={css.boardTabEmpty}>{all === 0 ? t('taskBoardEmptyInModal') : t('taskTabEmpty', { tab: t(activeTab.label) })}</div>}
            {sections.map(section => {
              const owners = section.owners.map(group => ({ ...group, visible: [...group.open, ...group.done].filter(matches) })).filter(group => group.visible.length > 0)
              if (owners.length === 0) return null
              return <div key={section.roomId} className={css.taskSection} data-room-id={section.roomId}>
                <h4 className={css.taskSectionTitle}>{sectionTitle(section, t)}</h4>
                {owners.map(group => <div key={group.owner} className={css.taskOwnerGroup} data-owner={group.owner}>
                  <div className={css.taskOwnerName}>{t('taskBoardOwner', { name: group.ownerName })}</div>
                  <ul className={css.boardCardGrid}>{group.visible.map(row)}</ul>
                </div>)}
              </div>
            })}
          </div>
          <div className={css.dialogActions}><button type="button" className={css.secondaryButton} onClick={close}>{t('close')}</button></div>
        </section>
      </div>, document.body)}
    </>
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
