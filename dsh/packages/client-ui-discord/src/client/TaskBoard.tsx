/**
 * Team mode B (#139): the task board beside the channel (who, what, status,
 * when it is next checked) and the task card shown for task records in the
 * message stream (one row per member: the task owner and its sub-tasks, each
 * with its elapsed time). Data comes from the snapshot's `tasks`.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { ChannelRoom, ChannelTask, TaskStatus } from './channel-source.ts'
import { BOARD_TABS, boardGroupOf, boardSections, inTab, cardMembers, sectionTitle, elapsed, formatDuration, STATUS_KEY, isTerminalTask, type T } from './task-board.ts'
import css from './ChannelsPage.module.css'
import { getScheme } from './scheme.ts'

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
/** Wide enough for the board to sit beside the chat (#125, owner's 11:53 sample: 右侧详情并排面板,
 * the sample's own breakpoint); narrower screens keep the overlay drawer. */
const SIDE_QUERY = '(min-width: 1101px)' // 来源：用户 11:53 样张 v1 的 @media(max-width:1100px) 断点
function useSideBySide(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(SIDE_QUERY) : undefined
  const [wide, setWide] = useState(query?.matches ?? false)
  useEffect(() => {
    if (query === undefined) return
    const update = () => { setWide(query.matches) }
    update()
    query.addEventListener?.('change', update)
    return () => { query.removeEventListener?.('change', update) }
  }, [query?.media])
  return wide
}

export function TaskBoard({ tasks, rooms, chatId, roomId, t, onOpen, onReview, onTerminate, dock, onDocked }: {
  tasks: readonly ChannelTask[]
  rooms: readonly ChannelRoom[]
  chatId: number | undefined
  roomId: number | undefined
  t: T
  onOpen: (roomId: number, messageId: number) => void
  onReview?: (id: number, verdict: 'done' | 'rework', note?: string) => Promise<void>
  onTerminate?: (id: number, action: 'cancel' | 'supersede', reason: string, supersededBy?: number) => Promise<void>
  /** Page column the board renders into beside the chat on wide screens; without it, always the drawer. */
  dock?: HTMLElement | null
  /** Told whether the board currently occupies the dock, so the page can make room for it. */
  onDocked?: (docked: boolean) => void
}) {
  const [opened, setOpened] = useState(false)
  const wide = useSideBySide()
  const docked = opened && wide && dock != null
  useEffect(() => { onDocked?.(docked) }, [docked])
  const [selectedTab, setSelectedTab] = useState(BOARD_TABS.find(tab => tab.initial)!.id)
  const [reviewing, setReviewing] = useState<number>()
  const [terminating, setTerminating] = useState<{ id: number; action: 'cancel' | 'supersede' }>()
  const [replacement, setReplacement] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const dialog = useRef<HTMLElement>(null)
  const titleId = useId()
  const tabId = useId()
  const now = Date.now() / 1000
  const sections = boardSections(tasks, rooms, chatId, roomId)
  const roomName = rooms.find(room => room.id === roomId)?.name ?? rooms.find(room => room.id === chatId)?.name ?? ''
  const channelTotal = sections.filter(section => section.chat).reduce((n, section) => n + section.open + section.done, 0)
  const workspaceTotal = sections.filter(section => !section.chat).reduce((n, section) => n + section.open + section.done, 0)
  const close = () => { setOpened(false) }
  // The drawer closes when the room changes; the side panel stays and follows the room, so a jump
  // from the board to a workspace message keeps the board next to it.
  const dockedRef = useRef(docked)
  dockedRef.current = docked
  useEffect(() => { if (!dockedRef.current) setOpened(false) }, [roomId])
  useEffect(() => {
    if (!opened) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => { previous?.focus() }
  }, [opened])
  const jump = (targetRoomId: number, messageId: number) => {
    if (!docked) flushSync(close)
    onOpen(targetRoomId, messageId)
  }
  const all = sections.reduce((n, s) => n + s.open + s.done, 0)
  const scopedTasks = sections.flatMap(section => section.owners.flatMap(group => [...group.open, ...group.done]))
  const groupCount = (group: string) => scopedTasks.filter(task => boardGroupOf(task) === group).length
  const activeTab = BOARD_TABS.find(tab => tab.id === selectedTab)!
  const matches = (task: ChannelTask) => inTab(activeTab, task)
  const visibleCount = scopedTasks.filter(matches).length
  const review = async (id: number, verdict: 'done' | 'rework') => {
    setSaving(true)
    setError(undefined)
    try {
      await onReview?.(id, verdict, verdict === 'rework' ? reason.trim() : undefined)
      setReviewing(undefined)
      setReason('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  const terminate = async () => {
    if (!terminating) return
    setSaving(true)
    setError(undefined)
    try {
      await onTerminate?.(terminating.id, terminating.action, reason.trim(), terminating.action === 'supersede' && replacement !== '' ? Number(replacement) : undefined)
      setTerminating(undefined)
      setReason('')
      setReplacement('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  const row = (task: ChannelTask) => (
    <li key={task.id} className={css.boardTaskCard} data-task-id={task.id} data-status={task.status} data-working={boardGroupOf(task) === 'working'} data-group={boardGroupOf(task)}>
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
        {onReview !== undefined && ['returned', 'declined', 'escalated'].includes(task.status) && <>
          <button type="button" className={css.linkButton} disabled={saving} onClick={() => { void review(task.id, 'done') }}>{t('taskApprove')}</button>
          <button type="button" className={css.linkButton} disabled={saving} onClick={() => { setTerminating(undefined); setReviewing(task.id); setReason(''); setError(undefined) }}>{t('taskSendBack')}</button>
        </>}
        {onTerminate !== undefined && !isTerminalTask(task) && <>
          {(['cancel', 'supersede'] as const).map(action => <button key={action} type="button" className={css.linkButton} disabled={saving} onClick={() => { setReviewing(undefined); setTerminating({ id: task.id, action }); setReason(''); setReplacement(''); setError(undefined) }}>{t(action === 'cancel' ? 'taskCancel' : 'taskSupersede')}</button>)}
        </>}
      </div>
      {task.termination_reason && <div className={css.taskMeta}>{t('taskTerminationNote', { reason: task.termination_reason })}</div>}
      {task.superseded_by != null && <div className={css.taskMeta}>{t('taskReplacement', { id: String(task.superseded_by) })}</div>}
      {reviewing === task.id && <form onSubmit={event => { event.preventDefault(); void review(task.id, 'rework') }}>
        <label>{t('taskReviewReason')}<input value={reason} required onChange={event => { setReason(event.target.value) }} /></label>
        <button type="submit" disabled={saving || !reason.trim()}>{t('taskReviewSubmit')}</button>
      </form>}
      {terminating?.id === task.id && !isTerminalTask(task) && <form onSubmit={event => { event.preventDefault(); void terminate() }}>
        <label>{t('taskTerminationReason')}<input value={reason} required maxLength={128 * 1024} onChange={event => { setReason(event.target.value) }} /></label>
        {terminating.action === 'supersede' && <label>{t('taskReplacementId')}<input type="number" min="1" step="1" value={replacement} onChange={event => { setReplacement(event.target.value) }} /></label>}
        <button type="submit" disabled={saving || !reason.trim()}>{t(terminating.action === 'cancel' ? 'taskConfirmCancel' : 'taskConfirmSupersede')}</button>
        <button type="button" disabled={saving} onClick={() => { setTerminating(undefined) }}>{t('taskKeep')}</button>
      </form>}
    </li>
  )
  return (
    <>
      <button type="button" className={css.taskBoardTrigger} aria-label={t('taskBoardOpen')} aria-haspopup={wide && dock != null ? undefined : 'dialog'} aria-expanded={opened} onClick={() => { if (docked) { close(); return } setSelectedTab((BOARD_TABS.find(tab => tab.groups.length > 0 && scopedTasks.some(task => inTab(tab, task))) ?? BOARD_TABS.find(tab => tab.initial)!).id); setOpened(true) }}>
        <span>{t('taskBoard')}</span>
        <span className={css.taskBoardSummary}>{all === 0 ? t('taskBoardNoTasks') : t('taskBoardSummary', { decide: String(groupCount('decide')), working: String(groupCount('working')) })}</span>
        <span aria-hidden="true">›</span>
      </button>
      {docked && createPortal(
        // Side by side: no backdrop, no focus trap, the chat stays usable; Escape or × closes.
        <section ref={dialog} className={`${css.dialog} ${css.taskBoardDialog} ${css.sidePanel}`} role="region" aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}>
          <h2 id={titleId} className={css.dialogTitle}>{t('taskBoard')} · {roomName}</h2>
          {docked && <button type="button" className={css.sidePanelClose} aria-label={t('taskBoardClose')} title={t('taskBoardClose')} onClick={close}>×</button>}
          {error !== undefined && <div role="alert">{error}</div>}
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
                {t(tab.label)} <span className={css.boardTabCount}>{scopedTasks.filter(task => inTab(tab, task)).length}</span>
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
          {!docked && <div className={css.dialogActions}><button type="button" className={css.secondaryButton} onClick={close}>{t('close')}</button></div>}
        </section>, dock!)}
      {opened && !docked && createPortal(<div className={`${css.dialogBackdrop} ${css.boardDrawerBackdrop}`} data-dc-scheme={getScheme()} onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
        <section ref={dialog} className={`${css.dialog} ${css.taskBoardDialog}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); close() }
          if (event.key === 'Tab') {
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [role="tabpanel"]'))
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
          }
        }}>
          <h2 id={titleId} className={css.dialogTitle}>{t('taskBoard')} · {roomName}</h2>
          {docked && <button type="button" className={css.sidePanelClose} aria-label={t('taskBoardClose')} title={t('taskBoardClose')} onClick={close}>×</button>}
          {error !== undefined && <div role="alert">{error}</div>}
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
                {t(tab.label)} <span className={css.boardTabCount}>{scopedTasks.filter(task => inTab(tab, task)).length}</span>
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
          {!docked && <div className={css.dialogActions}><button type="button" className={css.secondaryButton} onClick={close}>{t('close')}</button></div>}
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
            {/* 体检 #8: the task's own status is on the title line; its row only repeats a sub-task's. */}
            {m.id !== task.id && <Status status={m.status} t={t} />}
            <span className={css.taskMeta}>{formatDuration(elapsed(m, now), t)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
