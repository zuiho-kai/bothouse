/**
 * Channels main panel: room list, message stream with composer, and member
 * activity panel, in a conversation-first layout. All data arrives through the
 * injected `useChannels` hook; posting goes through the injected actions.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { softBreaksToHard } from './softBreaks.ts'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ChannelActions, ChannelMember, ChannelMemory, ChannelMessage, ChannelQuote, ChannelSnapshot, ChannelTask, OutgoingAttachment } from './channel-source.ts'
import { MAX_MESSAGE_BODY, MAX_ROWS, messageTooLarge } from './channel-source.ts'
import { AttachmentList, PendingAttachments, useComposerAttachments } from './Attachments.tsx'
import { dmRooms, groupRooms } from './channel-source.ts'
import { DeliveryPreview, deliverableOf, deliveredTasks } from './DeliveryPreview.tsx'
import { useCollabUrl } from './collab-url.ts'
import { boardGroupOf, isLiveTask } from './task-board.ts'
import { TaskBoard, TaskCard } from './TaskBoard.tsx'
import { ProgressCard, channelProgress, loadProgressFolded, saveProgressFolded } from './ProgressCard.tsx'
import { StepChips, chipsOf, compactBrief } from './StepChips.tsx'
import { CapabilityList } from './CapabilityList.tsx'
import { SlashMenu } from './SlashMenu.tsx'
import { addressCommand, answerFailed, commandAnswers, commandLine, matchCommands, needsTarget, slashQuery, type SlashCommand } from './slash-commands.ts'
import { activeMention, applyMention, insertMention, rankMembers } from './mention-complete.ts'
import { HighlightedMarkdown, renderQuoteMentions, splitMentions } from './mention-highlight.tsx'
import { MemberDialog } from './MemberDialog.tsx'
import { ChannelSettingsDialog, type SettingsTab } from './ChannelSettingsDialog.tsx'
import { Avatar } from './Avatar.tsx'
import { HeadTeam, headTeam } from './HeadTeam.tsx'
import { PermissionCard, type PermissionCardData } from './PermissionCard.tsx'
import { DecideTray, openQuestions } from './DecideTray.tsx'
import type { NS } from './locales.ts'
import { createLiveTracker, ENTER_STAGGER_MS, lastOwnEditable, prefersReducedMotion, trackLive, unreadCount, WITHDRAW_UNDO_MS } from './chat-motion.ts'
import css from './ChannelsPage.module.css'
import { setScheme, useScheme } from './scheme.ts'

/** Injected share: the channel snapshot source and its actions. */
export interface ChannelsInjected extends ChannelActions {
  /** Open shell models, or return false for the standalone web hint. */
  readonly openModelSettings: () => boolean
  readonly hooks: { readonly channels: HostObservable<ChannelSnapshot> }
}

/** Full props of the channels main panel. */
export type ChannelsPageProps = PropsRuntime<'main'> & InjectFace<ChannelsInjected> & PropsLocale<typeof NS> & {
  /** Direct reply to a member's question from the 等你定 tray; absent until the reply endpoint is live (#107/#118). */
  readonly answerTask?: (taskId: number, text: string) => Promise<void>
  /** #1016 转任务 on a message; absent hides the button. */
  readonly dispatchTask?: ChannelActions['dispatchTask']
  readonly openDm?: ChannelActions['openDm']
  readonly closeDm?: ChannelActions['closeDm']
}

type T = TranslateNS<typeof NS>

const CLI_TAG = { claude: 'kindClaude', codex: 'kindCodex', gemini: 'kindGemini' } as const

function KindTag({ kind, cli, name, t }: { name?: string; kind: ChannelMember['kind'] | undefined; cli?: ChannelMember['cli']; t: T }) {
  if (cli !== undefined) { const label = t(CLI_TAG[cli]); return name === label ? null : <span className={css.tag}>·{label}</span> }
  if (kind === 'dsh') return <span className={css.tag}>{t('kindDsh')}</span>
  if (kind === 'bot') return <span className={css.tag}>{t('kindBot')}</span>
  return null
}

/** IME candidate confirmation (desktop isComposing, iOS/Android keyCode 229) must not send/select/save. */
export function isImeEnter(event: { nativeEvent: KeyboardEvent | Event }): boolean {
  return Reflect.get(event.nativeEvent, 'isComposing') === true || Reflect.get(event.nativeEvent, 'keyCode') === 229
}

/** Touch or narrow screens get the short composer placeholder (the long one wraps beside the send button). */
function compactComposer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none), (max-width: 600px)').matches
}

/** The quoted original above a reply; a deleted original shows only a placeholder. */
function Quote({ quote, t, members, onMention }: { quote: ChannelQuote; t: T; members?: readonly ChannelMember[]; onMention?: (member: ChannelMember) => void }) {
  if (quote.deleted === true) return <div className={`${css.quote} ${css.quoteDeleted}`}>{t('replyDeleted')}</div>
  return (
    <div className={css.quote}>
      <span className={css.quoteAuthor}>{quote.name}</span>
      <span>{members ? renderQuoteMentions(quote.text, members, onMention) : quote.text}</span>
    </div>
  )
}

/**
 * 「细节」/「简略」 view of progress cards, remembered per room in the
 * browser so a reload or a new bundle starts in the last choice. Mirrors the
 * Discord card switch (bridge/platform/discord/card_view.go,
 * card_view_pref.go), default 简略 as there (cardViewDefault).
 */
export type CardView = 'detail' | 'brief'
const CARD_VIEW_DEFAULT: CardView = 'brief'
const CARD_VIEW_KEY = 'dsh-channels-card-view:'

export function loadCardView(roomId: number): CardView {
  try {
    const v = globalThis.localStorage?.getItem(CARD_VIEW_KEY + roomId)
    if (v === 'detail' || v === 'brief') return v
  } catch (error) { void error /* storage unavailable: use the default */ }
  return CARD_VIEW_DEFAULT
}

function saveCardView(roomId: number, view: CardView): void {
  try { globalThis.localStorage?.setItem(CARD_VIEW_KEY + roomId, view) } catch (error) { void error /* storage unavailable: keep the choice in memory */ }
}

/** Card metadata stored in `ChannelMessage.card` (progress, permission, task, failure, …). */
interface CardMeta { title?: string; state?: string; action?: string; kind?: string; task_id?: number; brief?: string; steps?: number; chips?: unknown }

export function parseCard(message: ChannelMessage): CardMeta | undefined {
  if (message.card === null) return undefined
  try { return JSON.parse(message.card) as CardMeta } catch (error) { void error /* unreadable card metadata: render the text alone */ }
  return undefined
}

/**
 * What the lead is doing, from real data only (11-04 review of the white scheme: the capsule
 * must say 「在干啥」— the current task's short name or the live progress-card brief; when
 * the lead is busy but reported nothing, say so instead of inventing text).
 * Order: failure/offline, then the lead's live task in this channel or its workspaces,
 * then the last line of its running progress card here, then busy-without-task, then idle.
 */
export function leadDoing(lead: ChannelMember, { tasks, rooms, thinking, messages }: {
  tasks: readonly ChannelTask[]; rooms: ReadonlySet<number>; thinking: Readonly<Record<string, readonly string[]>>; messages: readonly ChannelMessage[]
}, t: (key: 'memberFailed' | 'offline' | 'headLeadIdle' | 'headLeadBusyUnreported') => string): string {
  if (lead.error) return t('memberFailed')
  if (lead.online === false) return t('offline')
  const task = tasks.filter(x => x.owner === lead.id && rooms.has(x.room_id) && boardGroupOf(x) === 'working').sort((a, b) => b.updated_at - a.updated_at)[0]
  if (task !== undefined) return `#${task.id} ${task.title}`
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.author !== lead.id) continue
    const card = parseCard(m)
    if (cardRole(card) !== 'progress' || card?.state !== 'running') continue
    const line = (card.brief ?? '').split('\n').map(x => x.trim()).filter(Boolean).at(-1)
    if (line) return line
    break
  }
  if ([...rooms].some(id => (thinking[String(id)] ?? []).includes(lead.id))) return t('headLeadBusyUnreported')
  return t('headLeadIdle')
}

/**
 * Where a card sits in the layout (#113): a progress card is a slim run strip
 * under its author's reply, a member failure is an inline error bar, a pending
 * permission request is pinned above the composer, a task notice from the
 * system is a centered divider; anything else keeps the plain card.
 */
export type CardRole = 'none' | 'progress' | 'failure' | 'permission' | 'task' | 'other'
export function cardRole(card: CardMeta | undefined): CardRole {
  if (card === undefined) return 'none'
  if (card.kind === 'permission') return 'permission'
  if (card.kind === 'task') return 'task'
  if (card.kind === undefined && card.action === undefined && (typeof card.steps === 'number' || typeof card.brief === 'string' || card.state === 'running' || card.state === 'completed')) return 'progress'
  if (card.action === 'configure-model' || card.state === 'failed' || card.state === 'retried') return 'failure'
  return 'other'
}

/** A pending permission request: its buttons live in the tray above the composer. */
export function pendingPermission(message: ChannelMessage): boolean {
  const card = parseCard(message)
  return card?.kind === 'permission' && card.state === 'pending'
}

/** 用户 2026-11-04：完成的零/一步进度不占聊天行；失败步骤仍须可见。 */
function trivialProgress(message: ChannelMessage): boolean {
  const card = parseCard(message)
  return cardRole(card) === 'progress' && card?.state === 'completed'
    && typeof card.steps === 'number' && Number.isInteger(card.steps) && card.steps >= 0 && card.steps <= 1
    && !chipsOf(card)?.some(chip => chip.state === 'failed')
    && !(card.brief ?? message.text).split('\n').some(line => line.startsWith('❌ '))
}

// 来源：沿用 #98 规范「连续消息合在一起显示」；5 分钟窗口沿用 Slack/Discord 连续消息合并的惯例。
const GROUP_WINDOW_SEC = 300

/** Same author, close in time, plain or progress: the row drops its avatar and name. */
export function continues(previous: ChannelMessage | undefined, message: ChannelMessage): boolean {
  if (previous === undefined || previous.author_kind === 'system' || message.author_kind === 'system') return false
  if (previous.author !== message.author || previous.author_kind !== message.author_kind) return false
  if (message.reply_to !== undefined || message.created_at - previous.created_at > GROUP_WINDOW_SEC) return false
  const role = cardRole(parseCard(message))
  const before = cardRole(parseCard(previous))
  return (role === 'none' || role === 'progress') && (before === 'none' || before === 'progress')
}

function clockOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** #1020: the memory entries a reply used — a small badge that opens to their titles. */
function MemoryBadge({ items, t }: { items: readonly ChannelMemory[]; t: T }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.memory}>
      <button type="button" className={css.memoryBadge} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span aria-hidden="true">◇</span> {t('memoryBadge', { count: items.length })}
      </button>
      {open && (
        <ul className={css.memoryList} aria-label={t('memoryList')}>
          {items.map(item => (
            <li key={item.id} className={css.memoryItem}>
              <span className={css.memoryTitle}>{item.title || t('memoryMoved')}</span>
              <span className={css.memoryPage}>{item.page} #{item.ref}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** #148: inline editor state for one of your own messages. */
interface OwnActions {
  editing: string | undefined
  /** Another own message is being edited; that row's textarea owns focus. */
  editingOther: boolean
  onStartEdit: () => void
  onEditChange: (text: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onWithdraw: () => void
}


// 体检 #9: a touch press this long opens the message tools (common long-press length on phones).
const LONG_PRESS_MS = 450

function MessageRow({ message, member, members, t, onConfigure, menuOpen, onAvatar, onCloseMenu, onMention, onDm, onReview, onDecide, onReply, onTask, onRetry, retrying, tasks, focused, cardView, onCardView, own, grouped, enter, queuedFor, taskCardShown = true, toolsOpen = false, onLongPress }: {
  message: ChannelMessage
  /** 体检 #8: a task record shows its card only when no earlier row of this task already does. */
  taskCardShown?: boolean
  /** 体检 #9: on touch screens the tools show only after a long press on this row. */
  toolsOpen?: boolean
  onLongPress?: () => void
  grouped: boolean
  /** Stagger slot when this row arrived live (#115); undefined for history. */
  enter: number | undefined
  cardView: CardView
  onCardView: (view: CardView) => void
  own: OwnActions | undefined
  tasks: readonly ChannelTask[]
  focused: boolean
  member: ChannelMember | undefined
  members?: readonly ChannelMember[]
  t: T
  onConfigure: () => void
  menuOpen: boolean
  onAvatar: () => void
  onCloseMenu: () => void
  onMention: (member: ChannelMember) => void
  /** #1023 发私信 in the avatar menu; undefined hides it. */
  onDm: ((member: ChannelMember) => void) | undefined
  /** #1023 收下 on a delivered web page. */
  onReview?: (id: number, verdict: 'done' | 'rework', note?: string) => Promise<void>
  onDecide: ChannelActions['decidePermission']
  onReply: (message: ChannelMessage) => void
  /** #1016 转任务; undefined hides the button (no primary role or no endpoint). */
  onTask: ((message: ChannelMessage) => Promise<void>) | undefined
  onRetry: (messageId: number) => void
  retrying: boolean
  /** #1020: names of the members this own message waits for (queued behind their turn); undefined when it does not wait. */
  queuedFor?: readonly string[]
}) {
  const collabUrl = useCollabUrl()
  const labels = useMemo(() => ({ code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') }, footnotes: t('footnotes') }), [t])
  const card = parseCard(message)
  const role = cardRole(card)
  // Parse once per text change: MessageRow re-renders on every composer keystroke.
  const shown = typeof card?.brief === 'string' && cardView === 'brief' ? (role === 'progress' ? compactBrief(card.brief) : card.brief) : message.text
  const markdown = useMemo(() => softBreaksToHard(shown), [shown])
  const steps = role === 'progress' ? shown.slice(shown.indexOf('\n') + 1) : ''
  const stepsMarkdown = useMemo(() => (steps === '' ? '' : softBreaksToHard(steps)), [steps])
  const fullTime = new Date(message.created_at * 1000).toLocaleString()
  const editButtonRef = useRef<HTMLButtonElement>(null)
  // #1016 message tools: a short confirmation on the button that was used.
  const [toolNote, setToolNote] = useState<{ tool: 'copy' | 'task'; text: string } | undefined>(undefined)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(noteTimer.current) }, [])
  const note = (tool: 'copy' | 'task', text: string): void => {
    clearTimeout(noteTimer.current)
    setToolNote({ tool, text })
    noteTimer.current = setTimeout(() => { setToolNote(undefined) }, 2000)
  }
  const copy = (): void => {
    const done = (): void => { note('copy', t('toolCopied')) }
    const clip = globalThis.navigator?.clipboard
    if (clip === undefined) { note('copy', t('toolCopyFailed')); return }
    clip.writeText(message.text).then(done, () => { note('copy', t('toolCopyFailed')) })
  }
  const toTask = (): void => {
    if (onTask === undefined || toolNote?.tool === 'task') return
    setToolNote({ tool: 'task', text: t('toolTasking') })
    onTask(message).then(() => { note('task', t('toolTasked')) }, (error: unknown) => {
      note('task', t('toolTaskFailed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(press.current) }, [])
  const startPress = (): void => {
    clearTimeout(press.current)
    if (onLongPress !== undefined) press.current = setTimeout(onLongPress, LONG_PRESS_MS)
  }
  const endPress = (): void => { clearTimeout(press.current) }
  const wasEditing = useRef(false)
  const isEditing = own?.editing !== undefined
  useEffect(() => {
    // The edit button is recreated after save/cancel; the old DOM node is detached.
    // Switching the edit to another row must not pull focus back here (PR934 F2).
    if (wasEditing.current && !isEditing && own?.editingOther !== true) editButtonRef.current?.focus()
    wasEditing.current = isEditing
  }, [isEditing, own?.editingOther])

  const retryButtons = (role === 'failure' || card?.state === 'failed') && card !== undefined && (
    <div className={css.cardButtons}>
      {card.state !== 'retried' && (
        <button type="button" className={css.secondaryButton} disabled={retrying} onClick={() => onRetry(message.id)}>
          {retrying ? t('retrying') : t('retry')}
        </button>
      )}
      {card.action === 'configure-model' && (
        <button type="button" className={css.secondaryButton} onClick={onConfigure}>
          {t('configureModel')}
        </button>
      )}
    </div>
  )

  // #115: a row that arrived live rises in once (yours from the composer); history never animates.
  const enterClass = enter === undefined ? '' : message.author_kind === 'user' ? css.enterOwn : css.enter
  const enterStyle = enter ? { animationDelay: `${enter * ENTER_STAGGER_MS}ms` } : undefined

  // #113: a system notice (task reminders, joins) is a centered divider, not a member speaking;
  // a member failure posted by the system is an inline error bar with its retry right there.
  if (message.author_kind === 'system' && (role === 'none' || role === 'task')) {
    return (
      <div className={[css.systemRecord, enterClass, focused ? css.focused : ''].filter(Boolean).join(' ')} style={enterStyle} data-message-id={message.id} role="note">
        <div className={css.systemLine}>
          <span className={css.systemText} title={fullTime}><HighlightedMarkdown text={markdown} labels={labels} members={members} onMention={onMention} inline /></span>
        </div>
        {/* A task record keeps its live card, centered under the line. */}
        {card?.kind === 'task' && typeof card.task_id === 'number' && taskCardShown && <div className={`${css.card} ${css.taskRecord}`}><TaskCard taskId={card.task_id} tasks={tasks} t={t} /></div>}
      </div>
    )
  }
  if (message.author_kind === 'system' && role === 'failure') {
    return (
      <div className={[css.errorBar, enterClass, focused ? css.focused : ''].filter(Boolean).join(' ')} style={enterStyle} data-message-id={message.id} data-state={card?.state} role="alert">
        <span className={css.errorIcon} aria-hidden>!</span>
        <HighlightedMarkdown text={markdown} labels={labels} members={members} className={css.errorText} onMention={onMention} />
        {retryButtons}
      </div>
    )
  }

  const classes = [
    css.message, grouped ? css.grouped : '', message.author_kind === 'user' ? css.own : '', focused ? css.focused : '',
    enterClass, enter !== undefined && message.author_kind !== 'user' ? css.enterGlow : '',
  ].filter(Boolean).join(' ')
  // A task opened from this message (an @ dispatch, a handoff) shows its card here: the server posts
  // no 派活 record beside it (dsh/collab/tasks.mjs assign). A task record carries its own card, and a
  // sub-task anchored here too is a row of its parent's card.
  const anchored = card?.kind === 'task' ? [] : tasks.filter(task => task.assign_msg_id === message.id)
  const anchoredIds = new Set(anchored.map(task => task.id))
  const taskCards = anchored.filter(task => task.parent_task === null || !anchoredIds.has(task.parent_task))
  const progressLines = role === 'progress' ? shown.split('\n') : []
  // #1023: a hand-back that delivers a web page shows the page itself.
  const deliveredFor = deliveredTasks(message, tasks)
  const deliveredPage = deliveredFor.length > 0 ? deliverableOf(message, collabUrl) : undefined
  const delivered = deliveredPage === undefined ? undefined
    : { page: deliveredPage, task: deliveredFor.find(task => task.status === 'returned') ?? deliveredFor[0] }

  // A finished run in the brief view folds to its summary line; running or detailed shows the steps.
  const progressFolded = role === 'progress' && cardView === 'brief' && card?.state === 'completed'
  const chips = role === 'progress' ? chipsOf(card) : undefined
  return (
    <div className={classes} data-message-id={message.id} data-queued={queuedFor !== undefined || undefined} data-tools-open={toolsOpen || undefined} style={enterStyle}
      onTouchStart={startPress} onTouchEnd={endPress} onTouchMove={endPress} onTouchCancel={endPress}
      onContextMenu={(event) => {
        // Android turns a long press into contextmenu; on touch screens it opens the tools instead.
        if (onLongPress === undefined || typeof window.matchMedia !== 'function' || !window.matchMedia('(hover: none)').matches) return
        event.preventDefault()
        onLongPress()
      }}>
      {grouped
        ? <time className={css.gutterTime} title={fullTime} dateTime={new Date(message.created_at * 1000).toISOString()}>{clockOf(message.created_at)}</time>
        : member === undefined || message.author_kind === 'system'
        ? <Avatar id={message.author} name={message.name} avatar={member?.avatar} avatarVersion={member?.avatarVersion} />
        : (
            // Avatar opens this author's member menu; `data-avatar-menu` marks the
            // area an outside press must not land in to keep the menu open.
            <span className={css.avatarAnchor} data-avatar-menu onKeyDown={(event) => { if (event.key === 'Escape') onCloseMenu() }}>
              <button type="button" className={css.avatarButton} aria-label={t('memberMenu', { name: member.name })} aria-haspopup="menu" aria-expanded={menuOpen} onClick={onAvatar}
                onContextMenu={(event) => { event.preventDefault(); onMention(member) }}>
                <Avatar id={member.id} name={message.name} avatar={member.avatar} avatarVersion={member.avatarVersion} />
              </button>
              {menuOpen && (
                <div className={css.avatarMenu} role="menu" aria-label={t('memberMenu', { name: member.name })}>
                  <div className={css.avatarMenuTitle}>{member.name}</div>
                  <button type="button" role="menuitem" className={css.avatarMenuItem} onClick={() => { onMention(member) }}>{t('avatarMention')}</button>
                  {onDm !== undefined && member.kind !== 'human' && <button type="button" role="menuitem" className={css.avatarMenuItem} onClick={() => { onCloseMenu(); onDm(member) }}>{t('dmOpen')}</button>}
                </div>
              )}
            </span>
          )}
      <div className={css.messageBody}>
        {message.reply_to !== undefined && <Quote quote={message.reply_to} t={t} members={members} onMention={onMention} />}
        <div className={grouped ? `${css.messageHead} ${css.messageHeadGrouped}` : css.messageHead}>
          {!grouped && <span className={css.author}>{message.name}</span>}
          {!grouped && <KindTag name={message.name} kind={member?.kind} cli={member?.cli} t={t} />}
          {!grouped && <time className={css.time} title={fullTime} dateTime={new Date(message.created_at * 1000).toISOString()}>{clockOf(message.created_at)}</time>}
          {message.edited_at !== undefined && <span className={css.edited} title={new Date(message.edited_at * 1000).toLocaleString()}>{t('messageEdited')}</span>}
          {queuedFor !== undefined && <span className={css.queuedTag} title={t('queuedFor', { names: queuedFor.join('、') })}>{t('queuedTag')}</span>}
          {own !== undefined && own.editing === undefined && (
            <span className={css.ownActions}>
              <button ref={editButtonRef} type="button" className={css.linkButton} onClick={own.onStartEdit}>{t('messageEdit')}</button>
              <button type="button" className={css.linkButton} onClick={own.onWithdraw}>{t('messageWithdraw')}</button>
            </span>
          )}
        </div>
        {own?.editing !== undefined
          ? (
              <div className={css.editBox}>
                <textarea
                  className={css.editInput}
                  value={own.editing}
                  aria-label={t('messageEdit')}
                  autoFocus
                  onChange={(event) => { own.onEditChange(event.target.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.preventDefault(); own.onEditCancel() }
                    else if (event.key === 'Enter' && !event.shiftKey && !isImeEnter(event)) { event.preventDefault(); own.onEditSave() }
                  }}
                />
                <div className={css.editBar}>
                  <span className={css.time}>{t('messageEditHint')}</span>
                  <button type="button" className={css.secondaryButton} onClick={own.onEditCancel}>{t('messageCancel')}</button>
                  <button type="button" className={css.primaryButton} disabled={!own.editing.trim()} onClick={own.onEditSave}>{t('messageSave')}</button>
                </div>
              </div>
            )
          : card === undefined
          ? <>{message.text !== '' && <HighlightedMarkdown text={markdown} labels={labels} members={members} className={css.text} onMention={onMention} />}<AttachmentList attachments={message.attachments} t={t} />
              {delivered !== undefined && <DeliveryPreview page={delivered.page} task={delivered.task} t={t} onReview={onReview} onRevise={() => { onReply(message) }} />}</>
          : role === 'progress'
          ? (
              // #113: the run is a slim strip under the reply — spinner, step and time — that folds
              // to a summary once done; 简略/细节 stays as the strip's own switch.
              <div className={css.runStrip} data-state={card.state ?? 'running'}>
                <div className={css.runHead}>
                  <span className={css.runIcon} aria-hidden />
                  <span className={css.runTitle}>{card.title}</span>
                  <span className={css.runSummary}>{progressLines[0]}</span>
                  {typeof card.brief === 'string' && (
                    <div className={css.cardViews} role="group" aria-label={t('cardView')}>
                      {(['detail', 'brief'] as const).map(view => (
                        <button key={view} type="button" className={css.cardViewButton} aria-pressed={cardView === view} onClick={() => { onCardView(view) }}>
                          {t(view === 'detail' ? 'cardViewDetail' : 'cardViewBrief')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* #125: the brief view shows step chips when the card carries them; older cards keep the lines. */}
                {cardView === 'brief' && chips !== undefined
                  ? <StepChips chips={chips} runState={card.state} t={t} />
                  : !progressFolded && progressLines.length > 1 && (
                      <HighlightedMarkdown text={stepsMarkdown} labels={labels} members={members} className={`${css.text} ${css.runSteps}`} dataCardText onMention={onMention} />
                    )}
                {retryButtons}
              </div>
            )
          : role === 'permission' && card.state === 'pending'
          ? (
              // #113: the buttons are pinned above the composer so scrolling never loses them.
              <div className={css.permInline}>
                <span className={css.permLock} aria-hidden>●</span>
                <HighlightedMarkdown text={markdown} labels={labels} members={members} className={css.text} onMention={onMention} />
                <span className={css.permWaiting}>{t('permPending')}</span>
              </div>
            )
          : (
              <div className={css.card} data-state={card.state} data-role={role}>
                {card.title !== undefined && card.kind !== 'permission' && (
                  <div className={css.cardHead}>
                    <div className={css.cardTitle}>{card.title}</div>
                  </div>
                )}
                <HighlightedMarkdown text={markdown} labels={labels} members={members} className={css.text} onMention={onMention} />
                {retryButtons}
                {card.kind === 'permission' && <PermissionCard messageId={message.id} card={card as PermissionCardData} t={t} onDecide={onDecide} />}
                {card.kind === 'task' && typeof card.task_id === 'number' && <TaskCard taskId={card.task_id} tasks={tasks} t={t} />}
              </div>
            )}
        {taskCards.map(task => <div key={task.id} className={`${css.card} ${css.taskAnchor}`} data-anchored-task={task.id}><TaskCard taskId={task.id} tasks={tasks} t={t} /></div>)}
        {message.memories !== undefined && message.memories.length > 0 && <MemoryBadge items={message.memories} t={t} />}
      </div>
      {/* System notices and progress cards are not conversation turns, so they take no reply. */}
      {message.author_kind !== 'system' && card === undefined && (
        // #1016: hover toolbar — copy the Markdown, reply with a quote, put the message on the task board.
        <span className={css.msgTools} data-message-tools>
          {toolNote !== undefined && <span className={css.msgToolNote} role="status">{toolNote.text}</span>}
          {/* #1017: icons with a label 80 ms after hover (data-tip); aria-label keeps the name for readers. */}
          {message.text !== '' && <button type="button" className={css.msgTool} data-tip={t('toolCopy')} aria-label={t('toolCopy')} onClick={copy}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
          </button>}
          <button type="button" className={`${css.msgTool} ${css.replyButton}`} data-tip={t('reply')} aria-label={t('reply')} onClick={() => { onReply(message) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v5" /></svg>
          </button>
          {onTask !== undefined && message.text.trim() !== '' && <button type="button" className={css.msgTool} data-tip={t('toolTaskHint')} aria-label={t('toolTask')} disabled={toolNote?.tool === 'task' && toolNote.text === t('toolTasking')} onClick={toTask}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
          </button>}
        </span>
      )}
    </div>
  )
}

/** One pending permission request in the tray above the composer (#113). */
function PermTrayItem({ message, author, members, onMention, t, onDecide }: { message: ChannelMessage; author: ChannelMember | undefined; members?: readonly ChannelMember[]; onMention?: (member: ChannelMember) => void; t: T; onDecide: ChannelActions['decidePermission'] }) {
  const labels = useMemo(() => ({ code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') }, footnotes: t('footnotes') }), [t])
  const markdown = useMemo(() => softBreaksToHard(message.text), [message.text])
  const card = useMemo(() => parseCard(message), [message])
  return (
    <div className={css.permTrayItem} data-message-id={message.id}>
      <Avatar id={message.author} name={message.name} avatar={author?.avatar} avatarVersion={author?.avatarVersion} small />
      <div className={css.permTrayText}>
        <span className={css.permTrayWho}>{t('permAsks', { name: message.name })}</span>
        <HighlightedMarkdown text={markdown} labels={labels} members={members} className={css.text} onMention={onMention} />
      </div>
      <PermissionCard messageId={message.id} card={card as PermissionCardData} t={t} onDecide={onDecide} />
    </div>
  )
}

/**
 * #1017: an owner's bot command (`@橘 /model x`, `/stop all`) as one thin line — who it went to,
 * the command, and the bot's answer folded in (first line; click for all of it).
 */
function CommandRow({ message, target, command, answer, t }: {
  message: ChannelMessage
  target: string | undefined
  command: string
  answer: ChannelMessage | undefined
  t: T
}) {
  const [open, setOpen] = useState(false)
  const failed = answer !== undefined && answerFailed(answer.text)
  const first = answer?.text.split('\n').map(x => x.trim()).find(Boolean) ?? ''
  const more = answer !== undefined && answer.text.trim() !== first
  return (
    <div className={css.cmdLine} data-message-id={message.id} data-failed={failed} title={new Date(message.created_at * 1000).toLocaleString()}>
      <span>{target === undefined ? t('cmdToAll') : t('cmdTo', { name: target })}</span>
      <code>{command}</code>
      <span aria-hidden="true">·</span>
      {answer === undefined
        ? <span>{t('cmdSent')}</span>
        : more
          ? <button type="button" className={css.cmdResult} aria-expanded={open} onClick={() => { setOpen(!open) }}>{open ? answer.text : first}</button>
          : <span className={css.cmdResult}>{first}</span>}
    </div>
  )
}

function MemberGroup({ title, members, busy, onPick, onEdit, onRemove, onDm, t }: {
  title: string
  /** #1023 发私信 beside each agent; undefined hides it. */
  onDm?: (member: ChannelMember) => void
  members: readonly ChannelMember[]
  busy: ReadonlySet<string>
  onPick: (member: ChannelMember) => void
  onEdit: (member: ChannelMember) => void
  onRemove: (member: ChannelMember) => void
  t: T
}) {
  if (members.length === 0) return null
  return (
    <>
      <h3 className={css.groupTitle}>{title}</h3>
      {members.map(m => (
        <div key={m.id} className={`${css.memberRow} ${m.error ? css.memberFailed : m.online ? '' : css.offline}`}>
          <button
            type="button"
            className={css.member}
            title={t('mentionPick', { name: m.name })}
            onClick={() => { onPick(m) }}
          >
            <span className={css.memberAvatar}>
              <Avatar id={m.id} name={m.name} avatar={m.avatar} avatarVersion={m.avatarVersion} small />
              <span className={m.error ? `${css.presence} ${css.errorPresence}` : css.presence} />
            </span>
            <span className={css.memberText}>
              <span className={css.memberName}>{m.name}<KindTag name={m.name} kind={m.kind} cli={m.cli} t={t} /></span>
              {m.kind === 'dsh' && m.cli === undefined && (
                <span className={css.memberModel}>{m.model ? `${m.model.provider}/${m.model.model}` : t('defaultModel')}</span>
              )}
            </span>
            <span className={css.memberStatus} data-status={m.error ? 'error' : busy.has(m.id) ? 'busy' : m.online ? 'online' : 'offline'}>{m.error ? t('memberFailed') : busy.has(m.id) ? t('working') : m.online ? t('online') : t('offline')}</span>
          </button>
          {(m.kind === 'dsh' || (onDm !== undefined && m.kind !== 'human')) && (
            <span className={css.memberActions} title={m.kind === 'dsh' && m.editable !== true ? t('configMember') : undefined}>
              {onDm !== undefined && <button type="button" className={css.linkButton} onClick={() => { onDm(m) }}>{t('dmOpen')}</button>}
              {m.kind === 'dsh' && (m.editable === true
                ? <>
                    <button type="button" className={css.linkButton} onClick={() => { onEdit(m) }}>{t('editMember')}</button>
                    <button type="button" className={css.linkButton} onClick={() => { onRemove(m) }}>{t('removeMember')}</button>
                  </>
                : '⚙')}
            </span>
          )}
        </div>
      ))}
    </>
  )
}

/**
 * Render the channels panel.
 * @param props - framework, injected, and locale shares.
 * @returns the three-column channel view.
 */
export function ChannelsPage({ useChannels, selectRoom, send, reviewTask, dispatchTask, openDm, closeDm, createRoom, renameRoom, listModels, listClis, listPersonas, addMember, updateMember, removeMember, setLead, setWorkspacePath, renewRoom, setDispatchMode, setMaxRelay, decidePermission, retryMessage, editMessage, withdrawMessage, loadOlder, loadNewer, keepLatest, showLatest, openModelSettings, answerTask, t }: ChannelsPageProps) {
  const scheme = useScheme()
  const state = useChannels(snapshot => snapshot)
  // #148: the own message being edited, and the last edit/withdraw outcome to show.
  const [editing, setEditing] = useState<{ id: number; text: string } | undefined>(undefined)
  const [ownNotice, setOwnNotice] = useState<string | undefined>(undefined)
  // An edit started with ↑ in the composer returns there when it ends; one started from a
  // message's edit button returns to that button (PR934 F2, MessageRow).
  const editFromComposer = useRef(false)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string | undefined>>({})
  const [sending, setSending] = useState<Record<number, boolean>>({})
  // Per room: the message the next send replies to.
  const [replies, setReplies] = useState<Record<number, ChannelMessage | undefined>>({})
  // Per room: images/files waiting to go out with the next send (#144).
  const [pendingFiles, setPendingFiles] = useState<Record<number, readonly OutgoingAttachment[]>>({})
  const attach = useComposerAttachments((files) => {
    const roomId = state.roomId
    if (roomId === undefined) return
    const next = [...(pendingFiles[roomId] ?? []), ...files]
    if (messageTooLarge(drafts[roomId] ?? '', next)) {
      setErrors(previous => ({ ...previous, [roomId]: t('attachmentsTooLarge', { limit: `${MAX_MESSAGE_BODY / 1024 / 1024} MiB` }) }))
      return
    }
    setPendingFiles(previous => ({ ...previous, [roomId]: next }))
  }, (message) => {
    const roomId = state.roomId
    if (roomId !== undefined) setErrors(previous => ({ ...previous, [roomId]: t('sendFailed', { message }) }))
  })
  const pendingRooms = useRef(new Set<number>())
  const draft = state.roomId === undefined ? '' : drafts[state.roomId] ?? ''
  const sendError = state.roomId === undefined ? undefined : errors[state.roomId]
  const replying = state.roomId === undefined ? undefined : replies[state.roomId]
  const logRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  // #115 reading position: whether the reader is at the bottom, where unread rows
  // start (and whether the reader already reached them), and an older page in flight.
  const [atBottom, setAtBottom] = useState(true)
  const [unread, setUnread] = useState<{ roomId: number; fromId: number; seen: boolean } | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const olderAnchor = useRef<{ height: number; top: number } | undefined>(undefined)
  // #1030: a page that also drops rows at the far end keeps the row in view where it was.
  const rowAnchor = useRef<{ id: string; offset: number } | undefined>(undefined)
  const live = useRef(createLiveTracker())
  // #115 withdraw with undo: the row hidden for a few seconds before the request goes out.
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: number; commit: () => void } | undefined>(undefined)
  const withdrawTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingWithdrawRef = useRef(pendingWithdraw)
  pendingWithdrawRef.current = pendingWithdraw
  // Leaving the page carries out a pending withdrawal instead of dropping it.
  useEffect(() => () => {
    clearTimeout(withdrawTimer.current)
    pendingWithdrawRef.current?.commit()
  }, [])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputHighlightsRef = useRef<HTMLDivElement>(null)
  const [composing, setComposing] = useState(false)
  // The native textarea owns editing, selection and IME. Only its ink is mirrored.
  const syncInputHighlights = (): void => {
    const input = inputRef.current
    const highlights = inputHighlightsRef.current
    if (!input || !highlights) return
    // Exclude the native scrollbar without rounding fractional layout widths (clientWidth rounds).
    highlights.style.width = `${input.getBoundingClientRect().width - (input.offsetWidth - input.clientWidth)}px`
    highlights.scrollTop = input.scrollTop
    highlights.scrollLeft = input.scrollLeft
  }
  useLayoutEffect(() => {
    syncInputHighlights()
    const input = inputRef.current
    if (!input || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncInputHighlights)
    observer.observe(input)
    return () => observer.disconnect()
  }, [draft, state.roomId])
  // Caret offset in the draft; drives which `@query` (if any) is being typed.
  const [caret, setCaret] = useState(0)
  // `@` start index whose popup the user closed with Esc; a new `@` reopens.
  const [dismissedAt, setDismissedAt] = useState<number | undefined>(undefined)
  const [highlight, setHighlight] = useState(0)
  // Caret to restore after a programmatic edit, applied once the draft rendered.
  const pendingCaret = useRef<number | undefined>(undefined)
  // Member dialog: undefined closed, null adding, a member editing.
  const [dialog, setDialog] = useState<ChannelMember | null | undefined>(undefined)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [drawer, setDrawer] = useState<'rooms' | 'members' | undefined>(undefined)
  const roomsRef = useRef<HTMLElement>(null)
  const membersRef = useRef<HTMLElement>(null)
  const chatRef = useRef<HTMLElement>(null)
  const roomsToggleRef = useRef<HTMLButtonElement>(null)
  const membersToggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (drawer === undefined) return
    const surface = drawer === 'rooms' ? roomsRef.current : membersRef.current
    const opener = drawer === 'rooms' ? roomsToggleRef.current : membersToggleRef.current
    if (surface === null) return
    const background = [chatRef.current, drawer === 'rooms' ? membersRef.current : roomsRef.current]
      .filter((node): node is HTMLElement => node !== null)
    const previousInert = background.map(node => node.inert)
    background.forEach(node => { node.inert = true })
    const controls = (): HTMLElement[] => Array.from(surface.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0)
    ;(controls()[0] ?? surface).focus()
    const onKey = (event: globalThis.KeyboardEvent): void => {
      // A nested task/settings dialog owns its own focus cycle and Escape.
      const target = event.target as HTMLElement
      const nested = target.closest('[role="dialog"][aria-modal="true"]')
      if (nested !== null && nested !== surface) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDrawer(undefined)
      } else if (event.key === 'Tab') {
        const items = controls()
        const first = items[0]
        const last = items[items.length - 1]
        if (!items.includes(document.activeElement as HTMLElement) ||
            (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last ?? surface : first ?? surface).focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      background.forEach((node, index) => { node.inert = previousInert[index] as boolean })
      opener?.focus()
    }
  }, [drawer])
  // Wide-window side columns hidden by the user (#124); narrow windows use the drawers instead.
  const [roomsHidden, setRoomsHidden] = useState(false)
  // 来源：用户 11-03 白色方案，活动栏默认收起，保留现有展开与手机抽屉入口。
  const [membersHidden, setMembersHidden] = useState(true)
  const [boardDock, setBoardDock] = useState<HTMLDivElement | null>(null)
  const [boardDocked, setBoardDocked] = useState(false)
  const [newRoom, setNewRoom] = useState<string | undefined>(undefined)
  const [roomError, setRoomError] = useState<string | undefined>(undefined)
  const [memberError, setMemberError] = useState<string | undefined>(undefined)
  const [retryingId, setRetryingId] = useState<number | undefined>(undefined)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('basic')
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsReturnRef = useRef<HTMLButtonElement | null>(null)
  const leadCardRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const opener = settingsReturnRef.current
    return () => { opener?.focus() }
  }, [settingsOpen])
  useEffect(() => { setSettingsOpen(false) }, [state.roomId])
  const [capabilitiesDismissed, setCapabilitiesDismissed] = useState(false)
  // #1016: the capability help moved behind /help; the / menu runs commands.
  const [helpOpen, setHelpOpen] = useState(false)
  const [slashHighlight, setSlashHighlight] = useState(0)
  // #1017 the stop key's feedback: 正在停止 until the bot stops answering, then 已停止.
  const [stopping, setStopping] = useState<{ botId: string; name: string; phase: 'stopping' | 'stopped' } | undefined>(undefined)
  useEffect(() => { setCapabilitiesDismissed(false); setHelpOpen(false); setStopping(undefined) }, [state.roomId])
  const composerRef = useRef<HTMLDivElement>(null)
  // `@` start of the popup currently shown, read by the outside-click listener.
  const openMentionAt = useRef<number | undefined>(undefined)

  // Close the @ popup on a press outside the composer, like Esc: the draft and
  // its `@` stay. Presses inside (options, textarea, @ button) keep their own
  // handling, so picking a member is not swallowed.
  useEffect(() => {
    const onPress = (event: MouseEvent): void => {
      const at = openMentionAt.current
      if (composerRef.current?.contains(event.target as Node) === true) return
      if (at !== undefined) setDismissedAt(at)
      if (slashQuery(draft) !== undefined && !capabilitiesDismissed) setCapabilitiesDismissed(true)
      setHelpOpen(false)
    }
    document.addEventListener('mousedown', onPress)
    return () => { document.removeEventListener('mousedown', onPress) }
  }, [draft, capabilitiesDismissed])

  const backToComposer = (): void => {
    if (editFromComposer.current) pendingCaret.current = caret
    editFromComposer.current = false
  }

  useEffect(() => {
    const input = inputRef.current
    const next = pendingCaret.current
    if (input === null || next === undefined) return
    pendingCaret.current = undefined
    input.focus()
    input.setSelectionRange(next, next)
  })

  // Message whose avatar menu is open (#123); keyed by message so only one row shows it.
  const [avatarMenu, setAvatarMenu] = useState<number | undefined>(undefined)
  // 体检 #9: the message whose tools a long press opened on a touch screen; a press elsewhere closes them.
  const [toolsFor, setToolsFor] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (toolsFor === undefined) return
    const onPress = (event: Event): void => {
      if ((event.target as Element | null)?.closest?.(`[data-message-id="${toolsFor}"]`) == null) setToolsFor(undefined)
    }
    document.addEventListener('touchstart', onPress)
    document.addEventListener('mousedown', onPress)
    return () => { document.removeEventListener('touchstart', onPress); document.removeEventListener('mousedown', onPress) }
  }, [toolsFor])
  useEffect(() => { setToolsFor(undefined) }, [state.roomId])
  // 体检 #1: the 发私信 picker under the 私聊 heading.
  const [dmPicker, setDmPicker] = useState(false)
  const [cardViews, setCardViews] = useState<Record<number, CardView>>({})
  // #156: the 本频道进展 card folds away and stays folded across reloads, per room.
  const [progressFolded, setProgressFolded] = useState<Record<number, boolean>>({})
  const cardView = state.roomId === undefined ? CARD_VIEW_DEFAULT : cardViews[state.roomId] ?? loadCardView(state.roomId)
  const folded = state.roomId !== undefined && (progressFolded[state.roomId] ?? loadProgressFolded(state.roomId))
  const toggleProgress = (): void => {
    if (state.roomId === undefined) return
    const roomId = state.roomId
    saveProgressFolded(roomId, !folded)
    setProgressFolded(folds => ({ ...folds, [roomId]: !folded }))
  }
  const chooseCardView = (view: CardView): void => {
    if (state.roomId === undefined) return
    const roomId = state.roomId
    saveCardView(roomId, view)
    setCardViews(views => ({ ...views, [roomId]: view }))
    // The switched card text fades in instead of jumping (#115).
    if (prefersReducedMotion()) return
    requestAnimationFrame(() => {
      logRef.current?.querySelectorAll('[data-card-text]').forEach((el) => {
        el.animate?.([{ opacity: 0.25 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.2,0,0,1)' })
      })
    })
  }

  // Close the avatar menu on a press outside it (same document-press approach
  // as the @ popup); the draft is untouched and nothing is sent.
  useEffect(() => {
    if (avatarMenu === undefined) return
    const onPress = (event: MouseEvent): void => {
      if ((event.target as Element | null)?.closest?.('[data-avatar-menu]') == null) setAvatarMenu(undefined)
    }
    document.addEventListener('mousedown', onPress)
    return () => { document.removeEventListener('mousedown', onPress) }
  }, [avatarMenu])

  // Filter before grouping and reading-position tracking; keep raw history for paging.
  // Task cards anchored to a progress message must remain reachable.
  const visibleMessages = useMemo(() => state.messages.filter(m => !trivialProgress(m) || state.tasks?.some(task => task.assign_msg_id === m.id)), [state.messages, state.tasks])

  // Rows that arrived live animate in once; the first fill, a room switch and older pages do not.
  const fresh = useMemo(() => trackLive(live.current, state.roomId, state.messages), [state.messages, state.roomId])

  // An older page keeps the row the reader was looking at in place (#115).
  useLayoutEffect(() => {
    const log = logRef.current
    if (log === null) return
    const row = rowAnchor.current
    const el = row === undefined ? null : log.querySelector(`[data-message-id="${row.id}"]`)
    if (row !== undefined && el !== null) {
      // #1030: rows went at both ends; measure the row itself instead of the log height.
      rowAnchor.current = undefined
      olderAnchor.current = undefined
      log.scrollTop += el.getBoundingClientRect().top - log.getBoundingClientRect().top - row.offset
      return
    }
    const anchor = olderAnchor.current
    if (anchor === undefined) return
    olderAnchor.current = undefined
    rowAnchor.current = undefined
    log.scrollTop = log.scrollHeight - anchor.height + anchor.top
  }, [state.messages])

  // #1030: back at the newest message, the page sheds rows beyond the window size.
  useEffect(() => {
    if (stickRef.current && state.hasMoreNewer !== true && state.messages.length > MAX_ROWS) keepLatest?.()
  }, [state.messages, state.hasMoreNewer])

  // Follow new messages only while the reader is already at the bottom; otherwise
  // mark where the unread rows start so the divider and the pill can show them.
  const handled = useRef<{ roomId: number | undefined; id: number }>({ roomId: undefined, id: Number.NEGATIVE_INFINITY })
  useEffect(() => {
    const roomId = state.roomId
    const lastId = state.messages.length === 0 ? Number.NEGATIVE_INFINITY : (state.messages[state.messages.length - 1] as ChannelMessage).id
    const since = handled.current.roomId === roomId ? handled.current.id : lastId
    handled.current = { roomId, id: Math.max(since, lastId) }
    const log = logRef.current
    if (log !== null && stickRef.current) { log.scrollTop = log.scrollHeight; return }
    if (roomId === undefined) return
    const first = visibleMessages.find(m => m.id > since && fresh.has(m.id) && m.author_kind !== 'user')
    if (first !== undefined && (unread === undefined || unread.roomId !== roomId || unread.seen)) setUnread({ roomId, fromId: first.id, seen: false })
  }, [state.messages, state.roomId, visibleMessages])

  // #113: the permission tray takes room from the log, never covers it; stay at the latest message.
  const pendingKey = state.messages.filter(pendingPermission).map(m => m.id).join(',')
  useEffect(() => {
    const log = logRef.current
    if (log !== null && stickRef.current) log.scrollTop = log.scrollHeight
  }, [pendingKey])

  // Switching rooms clears the unread mark and fades the new room's rows in.
  useEffect(() => {
    setUnread(undefined)
    setAtBottom(true)
    const log = logRef.current
    if (log === null || prefersReducedMotion()) return
    log.animate?.([{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,0,0,1)' })
  }, [state.roomId])

  const scrollToLatest = (): void => {
    const log = logRef.current
    if (log === null) return
    stickRef.current = true
    setAtBottom(true)
    // #1030: the newest rows are not on the page; fetch them, then the stick effect lands at the bottom.
    if (state.hasMoreNewer === true) { void showLatest?.(); return }
    if (typeof log.scrollTo === 'function') log.scrollTo({ top: log.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    else log.scrollTop = log.scrollHeight
  }

  /** #1030: the first row at least partly in view and how far its top sits from the log's top. */
  const firstRowInView = (log: HTMLDivElement): { id: string; offset: number } | undefined => {
    const top = log.getBoundingClientRect().top
    for (const el of log.querySelectorAll('[data-message-id]')) {
      const box = el.getBoundingClientRect()
      if (box.bottom > top) return { id: el.getAttribute('data-message-id') ?? '', offset: box.top - top }
    }
    return undefined
  }

  /** #1030: the reader reached the bottom of a window that dropped its newest rows. */
  const pageForward = (): void => {
    const log = logRef.current
    if (log === null || loadNewer === undefined || loadingOlder || state.hasMoreNewer !== true) return
    rowAnchor.current = firstRowInView(log)
    setLoadingOlder(true)
    loadNewer().then((added) => { if (added === 0) rowAnchor.current = undefined }, (error: unknown) => {
      rowAnchor.current = undefined
      const roomId = state.roomId
      if (roomId !== undefined) setErrors(previous => ({ ...previous, [roomId]: error instanceof Error ? error.message : String(error) }))
    }).finally(() => { setLoadingOlder(false) })
  }

  const pageBack = (): void => {
    const log = logRef.current
    if (log === null || loadingOlder || state.hasMoreOlder !== true || state.messages.length === 0) return
    olderAnchor.current = { height: log.scrollHeight, top: log.scrollTop }
    // #1030: a full window also drops its newest rows, so the height alone no longer places the reader.
    if (state.messages.length + 100 > MAX_ROWS) rowAnchor.current = firstRowInView(log)
    setLoadingOlder(true)
    loadOlder().then((added) => { if (added === 0) olderAnchor.current = undefined }, (error: unknown) => {
      olderAnchor.current = undefined
      const roomId = state.roomId
      if (roomId !== undefined) setErrors(previous => ({ ...previous, [roomId]: error instanceof Error ? error.message : String(error) }))
    }).finally(() => { setLoadingOlder(false) })
  }

  // Task board link (#139 B): once the target room's messages are in, scroll to and mark the message.
  const [jump, setJump] = useState<{ roomId: number; messageId: number } | undefined>(undefined)
  const [focusedId, setFocusedId] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (jump === undefined || jump.roomId !== state.roomId) return
    const el = logRef.current?.querySelector(`[data-message-id="${jump.messageId}"]`)
    if (el == null) return
    stickRef.current = false
    el.scrollIntoView?.({ block: 'center' })
    setFocusedId(jump.messageId)
    setJump(undefined)
  }, [jump, state.messages, state.roomId])
  // #125: the title-bar teammates open the activity column (a drawer on narrow screens).
  const openActivity = (): void => {
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches // 沿用 ChannelsPage.module.css 抽屉断点
    if (narrow) setDrawer('members')
    else setMembersHidden(false)
  }
  const openMessage = (roomId: number, messageId: number): void => {
    setDrawer(undefined)
    setJump({ roomId, messageId })
    if (roomId !== state.roomId) void selectRoom(roomId)
  }

  // #1017 stop key: 正在停止 turns into 已停止 once the bot no longer answers in this room.
  const stillAnswering = stopping !== undefined && state.roomId !== undefined && (state.thinking[String(state.roomId)] ?? []).includes(stopping.botId)
  useEffect(() => {
    if (stopping === undefined) return
    if (stopping.phase === 'stopping' && !stillAnswering) { setStopping({ ...stopping, phase: 'stopped' }); return }
    // 已停止 shows for a moment; a stop the bot never confirms gives the key back after 30 s.
    const timer = setTimeout(() => { setStopping(undefined) }, stopping.phase === 'stopped' ? 2000 : 30_000)
    return () => { clearTimeout(timer) }
  }, [stopping, stillAnswering])
  if (state.phase !== 'ready') {
    const notice = state.phase === 'unavailable' ? t('unavailable')
      : state.phase === 'unauthorized' ? t('unauthorized')
        : state.phase === 'error' ? t('error', { message: state.error ?? '' })
          : t('loading')
    return <div className={css.page} data-dc-scheme={scheme}><div className={css.notice} role="status">{notice}</div></div>
  }

  const room = state.rooms.find(r => r.id === state.roomId)
  const channelId = room?.parent_id ?? room?.id
  // #1023: a private chat shows the owner and its one agent.
  const dmWith = room?.dm_member ?? undefined
  const visibleMembers = dmWith !== undefined
    ? state.members.filter(m => m.kind === 'human' || m.id === dmWith)
    : state.members.filter(m => !m.rooms?.length || (channelId !== undefined && m.rooms.includes(channelId)))
  const openTaskOwners = new Set(
    (state.tasks ?? []).filter(isLiveTask).map(t => t.owner)
  )
  const busy = new Set([
    ...(state.roomId === undefined ? [] : state.thinking[String(state.roomId)] ?? []),
    ...openTaskOwners,
  ])
  const byId = new Map(visibleMembers.map(m => [m.id, m]))
  // A progress update may hide the original unread row; place the divider at
  // the next visible unread message without losing the original reading boundary.
  const firstUnread = unread !== undefined && unread.roomId === state.roomId
    ? visibleMessages.find(m => m.id >= unread.fromId && m.author_kind !== 'user')?.id : undefined
  const visibleUnreadCount = unread !== undefined && unread.roomId === state.roomId && !unread.seen
    ? unreadCount(visibleMessages, unread.fromId) : 0
  const typingNames = (state.roomId === undefined ? [] : state.thinking[String(state.roomId)] ?? []).map(id => byId.get(id)?.name ?? id)
  // #1020: the owner's messages waiting behind a member's running turn here, and for whom.
  const queuedFor = new Map<number, string[]>()
  for (const [memberId, ids] of Object.entries(state.roomId === undefined ? {} : state.queued?.[String(state.roomId)] ?? {})) {
    for (const id of ids) queuedFor.set(id, [...(queuedFor.get(id) ?? []), byId.get(memberId)?.name ?? memberId])
  }
  const jumpToQueued = (): void => {
    const first = Math.min(...queuedFor.keys())
    document.querySelector(`[data-message-id="${first}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  // #113 activity: who is at work in this channel (here or in one of its workspaces) and on what.
  const channelRooms = new Set(state.rooms.filter(r => r.id === channelId || r.parent_id === channelId).map(r => r.id))
  // Match the settings selector: an explicit room null must not fall back to the global role.
  const leadId = room?.effective_lead_id === undefined ? state.effectiveLeadId ?? state.leadId : room.effective_lead_id
  const lead = visibleMembers.find(member => member.id === leadId)
  // No lead yet: say whether none is set or the member list has not arrived, never a made-up status.
  const leadStatus = lead !== undefined
    ? leadDoing(lead, { tasks: state.tasks ?? [], rooms: channelRooms, thinking: state.thinking, messages: state.messages }, t)
    : leadId == null ? t('headLeadUnset') : t('headLeadLoading')
  const openTasks = (state.tasks ?? []).filter(isLiveTask)
  const activity = visibleMembers.filter(m => m.kind !== 'human').flatMap((m) => {
    const where = [...channelRooms].find(id => (state.thinking[String(id)] ?? []).includes(m.id))
    const task = openTasks.find(task => task.owner === m.id && channelRooms.has(task.room_id))
    if (where === undefined && task === undefined) return []
    return [{ member: m, room: state.rooms.find(r => r.id === (where ?? task?.room_id)), task, thinking: where !== undefined }]
  })
  const pendingPerms = state.messages.filter(pendingPermission)
  const questions = openQuestions(state.tasks ?? [], channelRooms)
  const channelActive = room === undefined ? 0 : state.rooms.filter(r => channelRooms.has(r.id)).reduce((n, r) => n + (r.active ?? 0), 0)
  const mention = activeMention(draft, caret)
  const candidates = mention === undefined || mention.start === dismissedAt ? [] : rankMembers(visibleMembers, mention.query)
  const popupOpen = mention !== undefined && candidates.length > 0
  openMentionAt.current = popupOpen ? mention.start : undefined
  const selected = Math.min(highlight, Math.max(candidates.length - 1, 0))
  // #1016 / commands go to the primary role when it is a bothouse bot (only those run bridge commands).
  // 体检 #5: in a private chat the commands go to the one agent there.
  const dmPeer = dmWith === undefined ? undefined : byId.get(dmWith)
  const commandTarget = dmWith !== undefined ? (dmPeer?.kind === 'bot' ? dmPeer : undefined) : lead?.kind === 'bot' ? lead : undefined
  const slash = slashQuery(draft)
  // 体检 #5: a private chat has no 停频道全部 and no task board.
  const slashCommands = slash === undefined || capabilitiesDismissed || popupOpen ? []
    : matchCommands(slash, key => t(key)).filter(c => dmWith === undefined || (c.name !== 'stop all' && c.name !== 'board'))
  const slashOpen = slashCommands.length > 0
  const slashSelected = Math.min(slashHighlight, Math.max(slashCommands.length - 1, 0))
  // #1017: bothouse bots answering in this room; the send key stops one of them (the primary
  // role first) while the draft is empty. 停频道全部 and 改方向 live in the / menu only.
  const workingBots = (state.roomId === undefined ? [] : state.thinking[String(state.roomId)] ?? [])
    .map(id => byId.get(id)).filter((m): m is ChannelMember => m !== undefined && m.kind === 'bot')
  const stopTarget = workingBots.find(m => m.id === commandTarget?.id) ?? workingBots[0]
  const roomFiles = state.roomId === undefined ? [] : pendingFiles[state.roomId] ?? []
  const stopMode = (stopTarget !== undefined || stopping?.phase === 'stopping') && draft.trim() === '' && roomFiles.length === 0
  // 体检 #8: one card per task — on its dispatch message when that is loaded, else on its first record.
  const taskCardAt = new Map<number, number>()
  for (const m of visibleMessages) {
    for (const task of state.tasks ?? []) if (task.assign_msg_id === m.id && !taskCardAt.has(task.id) && parseCard(m)?.kind !== 'task') taskCardAt.set(task.id, m.id)
  }
  for (const m of visibleMessages) {
    const card = m.author_kind === 'system' ? parseCard(m) : undefined
    if (card?.kind === 'task' && typeof card.task_id === 'number' && !taskCardAt.has(card.task_id)) taskCardAt.set(card.task_id, m.id)
  }
  const recordShowsCard = (m: ChannelMessage): boolean => {
    const card = parseCard(m)
    return card?.kind !== 'task' || typeof card.task_id !== 'number' || taskCardAt.get(card.task_id) === m.id
  }
  // #1017: owner command lines and the bridge's answers to them, shown as one thin line.
  const answers = commandAnswers(state.messages, id => byId.get(id)?.name)
  const answerIds = new Set([...answers.values()].map(m => m.id))

  // A private chat renders no board, so a board left open in a channel takes no room there.
  const boardOpen = boardDocked && dmWith === undefined
  const placeholder = dmWith !== undefined
    ? t('dmPlaceholder', { name: dmPeer?.name ?? room?.name ?? '' })
    : t(compactComposer() || boardOpen ? 'placeholderShort' : 'placeholder', { room: room?.name ?? '' })
  // 体检 #10: on a phone the board and the colour switch live in the activity drawer.
  const openBoard = (): void => {
    setDrawer(undefined)
    setTimeout(() => { chatRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${t('taskBoardOpen')}"]`)?.click() }, 0)
  }

  const setDraft = (text: string, nextCaret: number): void => {
    const roomId = state.roomId
    if (roomId === undefined) return
    setDrafts(previous => ({ ...previous, [roomId]: text }))
    setCaret(nextCaret)
    setHighlight(0)
    pendingCaret.current = nextCaret
  }

  const choose = (member: ChannelMember): void => {
    if (mention === undefined) return
    const next = applyMention(draft, caret, mention, member)
    setDraft(next.text, next.caret)
  }

  const pickFromList = (member: ChannelMember): void => {
    setDrawer(undefined)
    const next = insertMention(draft, caret, member)
    setDraft(next.text, next.caret)
  }

  // Avatar menu "@": the same caret insertion as the member list, keeping the draft.
  // #1023: open (or reopen) the private chat with one agent and switch to it.
  const startDm = openDm === undefined ? undefined : (member: ChannelMember): void => {
    setDrawer(undefined)
    stickRef.current = true
    openDm(member.id).catch((error: unknown) => {
      setRoomError(t('dmOpenFailed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }
  // #155: close a private chat from the 私聊 list; its history stays and 发私信 reopens it.
  const endDm = closeDm === undefined ? undefined : (roomId: number): void => {
    closeDm(roomId).catch((error: unknown) => {
      setRoomError(t('dmCloseFailed', { message: error instanceof Error ? error.message : String(error) }))
    })
  }
  const mentionFromAvatar = (member: ChannelMember): void => {
    setAvatarMenu(undefined)
    pickFromList(member)
  }

  const submitRoom = (): void => {
    const name = (newRoom ?? '').trim()
    if (!name) { setNewRoom(undefined); return }
    setRoomError(undefined)
    createRoom(name).then(() => { setNewRoom(undefined) }).catch((error: unknown) => {
      setRoomError(error instanceof Error ? error.message : String(error))
    })
  }

  const ownActions = (m: ChannelMessage): OwnActions | undefined => {
    if (m.author_kind !== 'user' || m.card !== null) return undefined
    return {
      editing: editing?.id === m.id ? editing.text : undefined,
      editingOther: editing !== undefined && editing.id !== m.id,
      onStartEdit: () => { setOwnNotice(undefined); editFromComposer.current = false; setEditing({ id: m.id, text: m.text }) },
      onEditChange: (text) => { setEditing({ id: m.id, text }) },
      onEditCancel: () => { setEditing(undefined); backToComposer() },
      onEditSave: () => {
        if (editing?.id !== m.id || !editing.text.trim()) return
        if (editing.text === m.text) { setEditing(undefined); return }
        editMessage(m.id, editing.text).then(() => { setEditing(undefined); backToComposer() }, (error: unknown) => {
          setOwnNotice(error instanceof Error ? error.message : String(error))
        })
      },
      onWithdraw: () => {
        // #115: no confirm dialog; the row hides at once and the request goes out after a short undo window.
        setOwnNotice(undefined)
        clearTimeout(withdrawTimer.current)
        pendingWithdrawRef.current?.commit()
        let done = false
        const commit = (): void => {
          if (done) return
          done = true
          clearTimeout(withdrawTimer.current)
          setPendingWithdraw(current => (current?.id === m.id ? undefined : current))
          sendWithdraw(m.id)
        }
        setPendingWithdraw({ id: m.id, commit })
        withdrawTimer.current = setTimeout(commit, WITHDRAW_UNDO_MS)
      },
    }
  }

  const undoWithdraw = (): void => {
    clearTimeout(withdrawTimer.current)
    setPendingWithdraw(undefined)
  }

  const sendWithdraw = (id: number): void => {
        withdrawMessage(id).then(({ stopped, stillRunning }) => {
          const notes = [
            ...(stopped.length > 0 ? [t('withdrawStopped', { names: stopped.join('、') })] : []),
            ...(stillRunning.length > 0 ? [t('withdrawRunning', { names: stillRunning.join('、') })] : []),
          ]
          if (notes.length > 0) setOwnNotice(notes.join('；'))
        }, (error: unknown) => {
          setOwnNotice(error instanceof Error ? error.message : String(error))
        })
  }

  const confirmRemove = (member: ChannelMember): void => {
    if (!window.confirm(t('removeConfirm', { name: member.name }))) return
    setMemberError(undefined)
    removeMember(member.id).catch((error: unknown) => {
      setMemberError(error instanceof Error ? error.message : String(error))
    })
  }

  const openPicker = (): void => {
    const before = draft.slice(0, caret)
    const insert = before === '' || /\s$/.test(before) ? '@' : ' @'
    setDismissedAt(undefined)
    setDraft(before + insert + draft.slice(caret), caret + insert.length)
  }

  const handleRetry = (messageId: number): void => {
    setRetryingId(messageId)
    retryMessage(messageId).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      const roomId = state.roomId
      if (roomId !== undefined) setErrors(previous => ({ ...previous, [roomId]: msg }))
    }).finally(() => {
      setRetryingId(undefined)
    })
  }

  /** Send one command line now, keeping the draft unless it was the command itself; resolves to whether it went out. */
  const sendCommand = (text: string, clearDraft: boolean): Promise<boolean> => {
    const roomId = state.roomId
    if (roomId === undefined) return Promise.resolve(false)
    setErrors(previous => ({ ...previous, [roomId]: undefined }))
    stickRef.current = true
    if (state.hasMoreNewer === true) void showLatest?.()
    return send(text).then(() => {
      if (clearDraft) setDrafts(previous => ({ ...previous, [roomId]: '' }))
      return true
    }, (error: unknown) => {
      setErrors(previous => ({ ...previous, [roomId]: t('sendFailed', { message: error instanceof Error ? error.message : String(error) }) }))
      return false
    })
  }

  const noTarget = (): void => {
    const roomId = state.roomId
    if (roomId !== undefined) setErrors(previous => ({ ...previous, [roomId]: t('slashNoLead') }))
  }

  const runSlash = (command: SlashCommand): void => {
    const run = command.run
    if (commandTarget === undefined && needsTarget(command)) { noTarget(); return }
    setSlashHighlight(0)
    if (run.kind === 'panel') {
      setDraft('', 0)
      if (run.panel === 'help') { setCapabilitiesDismissed(false); setHelpOpen(true); return }
      chatRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${t('taskBoardOpen')}"]`)?.click()
      return
    }
    if (run.kind === 'send' && run.broadcast === true) { sendCommand(run.text, true); return }
    if (commandTarget === undefined) { noTarget(); return }
    const line = `@${commandTarget.name} ${run.text}`
    if (run.kind === 'fill') { setCapabilitiesDismissed(true); setDraft(line, line.length); return }
    sendCommand(line, true)
  }

  // #1017 the stop key: /stop to one bot — this reply of it, the session stays. 正在停止 until the
  // bot is no longer answering here, then 已停止 for a moment.
  const stopReply = (): void => {
    if (stopTarget === undefined || stopping?.phase === 'stopping') return
    const target = stopTarget
    setStopping({ botId: target.id, name: target.name, phase: 'stopping' })
    void sendCommand(`@${target.name} /stop`, false).then((sent) => { if (!sent) setStopping(undefined) })
  }

  const toTask = dispatchTask === undefined || state.roomId === undefined || leadId == null ? undefined : async (message: ChannelMessage): Promise<void> => {
    const line = message.text.split('\n').map(x => x.trim()).find(Boolean) ?? ''
    // 40 characters keeps the board row on one line (TaskBoard titles); the card links back to the full message.
    const title = line.length > 40 ? `${line.slice(0, 40)}…` : line
    await dispatchTask(message.room_id, { title, owner: leadId, messageId: message.id })
  }

  const submit = (): void => {
    const roomId = state.roomId
    const text = addressCommand(draft.trim(), commandTarget?.name)
    const files = roomId === undefined ? [] : pendingFiles[roomId] ?? []
    if ((!text && files.length === 0) || roomId === undefined || pendingRooms.current.has(roomId)) return
    if (files.length > 0 && messageTooLarge(text, files)) {
      setErrors(previous => ({ ...previous, [roomId]: t('attachmentsTooLarge', { limit: `${MAX_MESSAGE_BODY / 1024 / 1024} MiB` }) }))
      return
    }
    pendingRooms.current.add(roomId)
    setSending(previous => ({ ...previous, [roomId]: true }))
    setErrors(previous => ({ ...previous, [roomId]: undefined }))
    stickRef.current = true
    if (state.hasMoreNewer === true) void showLatest?.()
    setUnread(undefined)
    const replyTo = replies[roomId]?.id
    ;(files.length > 0 ? send(text, replyTo, files) : replyTo === undefined ? send(text) : send(text, replyTo)).then(() => {
      setDrafts(previous => ({ ...previous, [roomId]: '' }))
      setPendingFiles(previous => ({ ...previous, [roomId]: [] }))
      setReplies(previous => ({ ...previous, [roomId]: undefined }))
    }).catch((error: unknown) => {
      setErrors(previous => ({ ...previous, [roomId]: t('sendFailed', { message: error instanceof Error ? error.message : String(error) }) }))
    }).finally(() => {
      pendingRooms.current.delete(roomId)
      setSending(previous => ({ ...previous, [roomId]: false }))
    })
  }

  const startReply = (message: ChannelMessage): void => {
    const roomId = state.roomId
    if (roomId === undefined) return
    setReplies(previous => ({ ...previous, [roomId]: message }))
    pendingCaret.current = caret
  }

  const cancelReply = (): void => {
    const roomId = state.roomId
    if (roomId !== undefined) setReplies(previous => ({ ...previous, [roomId]: undefined }))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slashOpen && !isImeEnter(event)) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSlashHighlight((slashSelected + step + slashCommands.length) % slashCommands.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); runSlash(slashCommands[slashSelected] as SlashCommand); return }
      if (event.key === 'Escape') { event.preventDefault(); setCapabilitiesDismissed(true); return }
    }
    if (popupOpen && !isImeEnter(event)) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((selected + step + candidates.length) % candidates.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        choose(candidates[selected] as ChannelMember)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedAt(mention?.start)
        return
      }
    }
    // #115: ↑ in an empty composer edits your last message, as in most chat apps.
    if (event.key === 'ArrowUp' && draft === '' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && !isImeEnter(event)) {
      const last = lastOwnEditable(state.messages, pendingWithdraw?.id)
      if (last !== undefined) {
        event.preventDefault()
        setOwnNotice(undefined)
        editFromComposer.current = true
        setEditing({ id: last.id, text: last.text })
        requestAnimationFrame(() => { logRef.current?.querySelector(`[data-message-id="${last.id}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }) })
        return
      }
    }
    // Same rule as DSH's own editor (dsh-client-ui-primitives: Enter sends unless Shift or an IME
    // is composing; keyCode 229 covers Safari/iOS, which reports composition that way).
    if (event.key === 'Enter' && !event.shiftKey && !isImeEnter(event)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className={[css.page, roomsHidden ? css.roomsHidden : '', membersHidden ? css.membersHidden : '', boardOpen ? css.panelOpen : ''].filter(Boolean).join(' ')} data-dc-scheme={scheme}>
      {drawer !== undefined && <button className={css.drawerBackdrop} aria-label={t('closeDrawer')} onClick={() => setDrawer(undefined)} />}
      <nav ref={roomsRef} className={drawer === 'rooms' ? `${css.rooms} ${css.drawerOpen}` : css.rooms} aria-label={t('rooms')} role={drawer === 'rooms' ? 'dialog' : undefined} aria-modal={drawer === 'rooms' ? true : undefined} tabIndex={drawer === 'rooms' ? -1 : undefined}>
        {/* 白色方案：左栏顶部置顶当前主角色（总管）卡，和右上胶囊同一份状态；没有总管时显示兜底文字。 */}
        {/* 没设主角色时，频道设置在收起的活动栏里，新用户找不到：卡片本身就是去频道设置选主角色的入口。 */}
        <div className={css.leadCard} role="group" aria-label={t('leadCard')}>
          <button
            ref={leadCardRef}
            type="button"
            className={css.leadCardButton}
            disabled={room === undefined}
            title={`${lead === undefined ? leadStatus : `${lead.name} · ${leadStatus}`}\n${t('leadCardChange')}`}
            onClick={() => { settingsReturnRef.current = leadCardRef.current; setDrawer(undefined); setSettingsTab('dispatch'); setSettingsOpen(true) }}
          >
            {lead !== undefined && <Avatar id={lead.id} name={lead.name} avatar={lead.avatar} avatarVersion={lead.avatarVersion} />}
            <span className={css.leadCardText}>
              <span className={css.leadCardName}>{lead?.name ?? t('headLead')}</span>
              <span className={css.leadCardStatus}>{t('leadPinned')} · {leadStatus}</span>
              <span className={css.leadCardHint}>{leadId == null ? t('leadCardSet') : t('leadCardHint')}</span>
            </span>
          </button>
        </div>
        <div className={css.groupHead}>
          <h3 className={css.groupTitle}>{t('rooms')}</h3>
          <button type="button" className={css.iconButton} title={t('newRoom')} aria-label={t('newRoom')} onClick={() => { setNewRoom(''); setRoomError(undefined) }}>+</button>
        </div>
        {newRoom !== undefined && (
          <input
            className={css.roomInput}
            autoFocus
            value={newRoom}
            maxLength={32}
            placeholder={t('newRoomPlaceholder')}
            aria-label={t('newRoom')}
            onChange={(event) => { setNewRoom(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isImeEnter(event)) { event.preventDefault(); submitRoom() }
              if (event.key === 'Escape') { setNewRoom(undefined); setRoomError(undefined) }
            }}
            onBlur={() => { if ((newRoom ?? '').trim() === '') setNewRoom(undefined) }}
          />
        )}
        {roomError !== undefined && <div className={css.sendError} role="alert">{roomError}</div>}
        {groupRooms(state.rooms).map(({ room: r, depth }) => {
          // #139: workspaces sit indented under their chat channel and always show their
          // in-progress count; a chat channel shows it only when something is in progress.
          const active = r.active ?? 0
          // #113: a count only when something runs; idle workspaces no longer repeat 「进行中 0 件」.
          const showActive = active > 0
          const workers = (state.thinking[String(r.id)] ?? []).map(id => state.members.find(m => m.id === id)).filter((m): m is ChannelMember => m !== undefined)
          const fresh = r.id === state.roomId ? 0 : state.unread?.[String(r.id)] ?? 0
          // 体检 #7: who is at work here, in words, instead of an unlabelled dot.
          const working = workers.length === 0 ? undefined : workers.length === 1 ? t('roomWorking', { name: workers[0]!.name }) : t('roomWorkingMany', { count: String(workers.length) })
          return (
            <button
              key={r.id}
              type="button"
              data-unread={fresh > 0 || undefined}
              className={[css.room, depth === 1 ? css.workspace : '', r.id === state.roomId ? css.roomActive : '', fresh > 0 ? css.roomUnread : ''].filter(Boolean).join(' ')}
              aria-current={r.id === state.roomId}
              onClick={() => { stickRef.current = true; setDrawer(undefined); void selectRoom(r.id) }}
            >
              <span className={css.hash} aria-hidden>#</span><span className={css.roomLabel}>{r.name}</span>
              {working !== undefined && <span className={css.roomWorking} aria-hidden title={workers.map(m => m.name).join('、')}><span className={css.roomWorkingDot} aria-hidden />{working}</span>}
              {fresh > 0 && <span className={css.unreadBadge} aria-label={t('roomUnread', { count: String(fresh) })}>{fresh > 99 ? '99+' : fresh}</span>}
              {showActive && <span className={active > 0 ? `${css.activeCount} ${css.activeBusy}` : css.activeCount}>{t('activeTasks', { count: active })}</span>}
            </button>
          )
        })}
        <div className={`${css.groupHead} ${css.dmHead}`}>
          <h3 className={css.groupTitle}>{t('dmGroup')}</h3>
          {startDm !== undefined && <button type="button" className={css.iconButton} title={t('dmNew')} aria-label={t('dmNew')} aria-expanded={dmPicker} onClick={() => { setDmPicker(!dmPicker) }}>+</button>}
        </div>
        {dmPicker && startDm !== undefined && (
          <div className={css.dmPicker} role="menu" aria-label={t('dmPickTitle')}>
            {state.members.filter(m => m.kind !== 'human').length === 0
              ? <div className={css.dmPickNone}>{t('dmPickNone')}</div>
              : state.members.filter(m => m.kind !== 'human').map(m => (
                  <button key={m.id} type="button" role="menuitem" className={css.room} onClick={() => { setDmPicker(false); startDm(m) }}>
                    <span className={css.dmAvatar}><Avatar id={m.id} name={m.name} avatar={m.avatar} avatarVersion={m.avatarVersion} small /></span>
                    <span className={css.roomLabel}>{m.name}</span>
                  </button>
                ))}
          </div>
        )}
        {startDm !== undefined && dmRooms(state.rooms).length === 0 && !dmPicker && (
          <button type="button" className={`${css.room} ${css.dmNewRow}`} onClick={() => { setDmPicker(true) }}>+ {t('dmNew')}</button>
        )}
        {dmRooms(state.rooms).map(r => {
          const peer = state.members.find(m => m.id === r.dm_member)
          const label = peer?.name ?? r.name
          const fresh = r.id === state.roomId ? 0 : state.unread?.[String(r.id)] ?? 0
          return (
            <div key={r.id} className={css.dmRow}>
              <button
                type="button"
                data-unread={fresh > 0 || undefined}
                className={[css.room, r.id === state.roomId ? css.roomActive : '', fresh > 0 ? css.roomUnread : ''].filter(Boolean).join(' ')}
                aria-current={r.id === state.roomId}
                data-dm-room={r.dm_member}
                onClick={() => { stickRef.current = true; setDrawer(undefined); void selectRoom(r.id) }}
              >
                <span className={css.dmAvatar}><Avatar id={r.dm_member ?? ''} name={label} avatar={peer?.avatar} avatarVersion={peer?.avatarVersion} small /></span>
                <span className={css.roomLabel}>{label}</span>
                {fresh > 0 && <span className={css.unreadBadge} aria-label={t('roomUnread', { count: String(fresh) })}>{fresh > 99 ? '99+' : fresh}</span>}
              </button>
              {endDm !== undefined && (
                <button type="button" className={css.dmClose} data-dm-close={r.id} title={t('dmClose')} aria-label={t('dmCloseNamed', { name: label })} onClick={() => { endDm(r.id) }}>×</button>
              )}
            </div>
          )
        })}
      </nav>
      <section ref={chatRef} className={css.chat}>
        <header className={css.chatHead}>
          <button ref={roomsToggleRef} type="button" className={css.mobileButton} aria-label={t('showRooms')} aria-expanded={drawer === 'rooms'} onClick={() => setDrawer(drawer === 'rooms' ? undefined : 'rooms')}>☰</button>
          <button type="button" className={css.panelToggle} title={t(roomsHidden ? 'expandRooms' : 'collapseRooms')} aria-label={t(roomsHidden ? 'expandRooms' : 'collapseRooms')} aria-expanded={!roomsHidden} onClick={() => { setRoomsHidden(!roomsHidden) }}>{roomsHidden ? '»' : '«'}</button>
          <span className={css.hash} aria-hidden>{dmWith !== undefined ? '@' : '#'}</span><span className={css.roomName}>{dmWith !== undefined ? (state.members.find(m => m.id === dmWith)?.name ?? room?.name) : room?.name}</span>
          {/* 体检 #1/#4: the member count opens the member list; a private chat shows neither it nor the board. */}
          {dmWith === undefined && (
            <button type="button" className={css.headMeta} title={t('showMembersList')} onClick={openActivity}>
              {t('headMembers', { count: visibleMembers.length })}
              {channelActive > 0 && <> · {t('activeTasks', { count: channelActive })}</>}
            </button>
          )}
          {dmWith === undefined && <HeadTeam mates={headTeam(visibleMembers, leadId, state.tasks ?? [], state.thinking, channelRooms)} t={t} onOpen={openActivity} />}
          {dmWith === undefined
            ? <TaskBoard tasks={state.tasks ?? []} rooms={state.rooms} chatId={state.taskChat} roomId={state.roomId} t={t} onOpen={openMessage} onReview={reviewTask} dock={boardDock} onDocked={setBoardDocked} />
            : <span className={css.headSpacer} />}
          {/* 体检 #6: the primary role shows once, on the card at the top of the channel list. */}
          <button type="button" className={css.schemeToggle} title={t(scheme === 'light' ? 'schemeToDark' : 'schemeToLight')} aria-label={t(scheme === 'light' ? 'schemeToDark' : 'schemeToLight')} aria-pressed={scheme === 'dark'} onClick={() => { setScheme(scheme === 'light' ? 'dark' : 'light') }}>{scheme === 'light' ? '☾' : '☀'}</button>
          <button type="button" className={`${css.panelToggle} ${css.panelToggleEnd}`} title={t(membersHidden ? 'expandMembers' : 'collapseMembers')} aria-label={t(membersHidden ? 'expandMembers' : 'collapseMembers')} aria-expanded={!membersHidden} onClick={() => { setMembersHidden(!membersHidden) }}>{membersHidden ? '«' : '»'}</button>
          <button ref={membersToggleRef} type="button" className={css.mobileButton} aria-label={t('showMembers')} aria-expanded={drawer === 'members'} onClick={() => setDrawer(drawer === 'members' ? undefined : 'members')}>{t('membersButton')}</button>
        </header>
        {/* 体检 #3: 本频道进展 is its own row under the title bar, so it never covers a message. */}
        {dmWith === undefined && <ProgressCard lines={channelProgress(state.tasks ?? [], channelRooms)} t={t} onOpen={openMessage} folded={folded} onToggle={toggleProgress} />}
        {/* #115: the log and its floating pill/undo toast share one box, so they sit just above the composer and any tray. */}
        <div className={css.logWrap}>
        <div
          ref={logRef}
          className={css.log}
          role="log"
          aria-live="polite"
          onScroll={(event) => {
            const el = event.currentTarget
            const edge = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
            // #1030: the bottom of a window that dropped its newest rows is not the newest message.
            if (edge && state.hasMoreNewer === true) pageForward()
            const bottom = edge && state.hasMoreNewer !== true
            stickRef.current = bottom
            if (bottom !== atBottom) setAtBottom(bottom)
            if (bottom && unread !== undefined && !unread.seen) setUnread({ ...unread, seen: true })
            // Same 40px margin as the bottom check: near the top, page further back.
            if (el.scrollTop <= 40) pageBack()
          }}
        >
          {!visibleMembers.some(m => m.kind !== 'human') && (
            <div className={css.guide}>
              <div>{t('guideNoMembers')}</div>
              <button type="button" className={css.primaryButton} onClick={() => { setDialog(null) }}>{t('addMember')}</button>
            </div>
          )}
          {loadingOlder && <div className={css.olderLoading} role="status">{t('loadingOlder')}</div>}
          {visibleMessages.length === 0
            ? <div className={css.empty}>{dmWith !== undefined ? t('dmEmpty', { name: dmPeer?.name ?? room?.name ?? '' }) : t('empty')}</div>
            : visibleMessages.map((m, index) => [
                firstUnread === m.id
                  ? <div key={`unread-${m.id}`} className={css.unreadDivider} role="separator">{t('newMessagesDivider')}</div>
                  : null,
                pendingWithdraw?.id === m.id
                  ? <div key={m.id} className={css.withdrawnRow} data-message-id={m.id}>{t('withdrawPending')}</div>
                  : answerIds.has(m.id) ? null
                  : m.author_kind === 'user' && m.card === null && commandLine(m.text) !== undefined
                  ? <CommandRow key={m.id} message={m} target={commandLine(m.text)?.target} command={commandLine(m.text)?.command ?? ''} answer={answers.get(m.id)} t={t} />
                  : <MessageRow
                  key={m.id}
                  enter={fresh.get(m.id)}
                  message={m}
                  // #1017: a command line or its folded answer above is no bubble to group under.
                  grouped={continues(visibleMessages[index - 1], m) && !answerIds.has(visibleMessages[index - 1]?.id ?? -1) && !(visibleMessages[index - 1]?.author_kind === 'user' && commandLine(visibleMessages[index - 1]?.text ?? '') !== undefined)}
                  member={byId.get(m.author)}
                  members={visibleMembers}
                  t={t}
                  onConfigure={() => { if (!openModelSettings()) setModelsOpen(true) }}
                  menuOpen={avatarMenu === m.id}
                  cardView={cardView}
                  onCardView={chooseCardView}
                  onAvatar={() => { setAvatarMenu(avatarMenu === m.id ? undefined : m.id) }}
                  onCloseMenu={() => { setAvatarMenu(undefined) }}
                  onMention={mentionFromAvatar}
                  onDm={startDm}
                  onReview={reviewTask}
                  onDecide={decidePermission}
                  onRetry={handleRetry}
                  retrying={retryingId === m.id}
                  tasks={state.tasks ?? []}
                  focused={focusedId === m.id}
                  onReply={startReply}
                  onTask={toTask}
                  own={ownActions(m)}
                  queuedFor={queuedFor.get(m.id)}
                  taskCardShown={recordShowsCard(m)}
                  toolsOpen={toolsFor === m.id}
                  onLongPress={() => { setToolsFor(m.id) }}
                />,
              ])}
        </div>
        {pendingWithdraw !== undefined && (
          <div className={css.undoToast} role="status">
            <span>{t('withdrawToast')}</span>
            <button type="button" className={css.undoButton} onClick={undoWithdraw}>{t('withdrawUndo')}</button>
            <span className={css.undoBar} style={{ animationDuration: `${WITHDRAW_UNDO_MS}ms` }} aria-hidden="true" />
          </div>
        )}
        {(!atBottom || state.hasMoreNewer === true) && state.messages.length > 0 && (
          <button type="button" className={css.jumpLatest} onClick={scrollToLatest}>
            <span aria-hidden="true">↓</span> {t('jumpLatest')}
            {visibleUnreadCount > 0
              && <span className={css.jumpCount}>{t('jumpLatestCount', { count: visibleUnreadCount })}</span>}
          </button>
        )}
        </div>
        <div className={css.working} aria-live="polite">
          {typingNames.length > 0 && <><span className={css.typingDots} aria-hidden="true"><i /><i /><i /></span>{t('workingList', { names: typingNames.join('、') })}</>}
          {queuedFor.size > 0 && <button type="button" className={css.queuedButton} title={t('queuedJump')} onClick={jumpToQueued}>{t('queuedCount', { count: queuedFor.size })}</button>}
        </div>
        {/* #113/#125: questions and pending permission requests stay pinned above the composer while the log scrolls. */}
        <DecideTray
          questions={questions}
          permissionCount={pendingPerms.length}
          permissions={pendingPerms.length > 0 && (
            <div className={css.permTray} role="region" aria-label={t('permTray', { count: pendingPerms.length })}>
              {pendingPerms.map(m => <PermTrayItem key={m.id} message={m} author={byId.get(m.author)} members={visibleMembers} onMention={mentionFromAvatar} t={t} onDecide={decidePermission} />)}
            </div>
          )}
          t={t}
          onAnswer={answerTask}
          isImeEnter={isImeEnter}
        />
        <div className={css.composer} ref={composerRef}>
          {helpOpen && <CapabilityList key={state.roomId} t={t} onClose={() => { setHelpOpen(false) }} />}
          {slashOpen && <SlashMenu commands={slashCommands} selected={slashSelected} target={commandTarget?.name} dmName={dmWith === undefined ? undefined : dmPeer?.name ?? room?.name} disabled={c => commandTarget === undefined && needsTarget(c)} grouped={slash === ''} t={t} onPick={runSlash} onHover={setSlashHighlight} />}
          {sendError !== undefined && <div className={css.sendError} role="alert">{sendError}</div>}
          {ownNotice !== undefined && <div className={css.sendError} role="status">{ownNotice}</div>}
          {popupOpen && (
            <div className={css.mentionPopup}>
              <div className={css.mentionTitle}>
                {mention.query === '' ? t('mentionTitle') : t('mentionTitleQuery', { query: mention.query })}
              </div>
              <div role="listbox" id="channel-mention-list" aria-label={t('mentionTitle')}>
                {candidates.map((m, index) => (
                  <div
                    key={m.id}
                    id={`channel-mention-${m.id}`}
                    role="option"
                    aria-selected={index === selected}
                    className={index === selected ? `${css.mentionItem} ${css.mentionActive}` : css.mentionItem}
                    // Keep focus in the textarea so typing continues after a click.
                    onMouseDown={(event) => { event.preventDefault() }}
                    onMouseEnter={() => { setHighlight(index) }}
                    onClick={() => { choose(m) }}
                  >
                    <span className={css.memberAvatar}>
                      <Avatar id={m.id} name={m.name} avatar={m.avatar} avatarVersion={m.avatarVersion} small />
                      {m.online && <span className={m.error ? `${css.presence} ${css.errorPresence}` : css.presence} />}
                    </span>
                    <span className={css.mentionName}>{m.name}</span>
                    <KindTag name={m.name} kind={m.kind} cli={m.cli} t={t} />
                    <span className={css.mentionMeta}>
                      {m.error ? t('memberFailed') : busy.has(m.id) ? t('working') : m.online ? `@${m.id}` : t('offline')}
                    </span>
                  </div>
                ))}
              </div>
              <div className={css.mentionHint}>{t('mentionHint')}</div>
            </div>
          )}
          <div className={css.composerBox}>
            {replying !== undefined && (
              <div className={css.replyBar}>
                <span className={css.replyBarText}>
                  {t('replyingTo', { name: replying.name })}
                  {state.messages.some(m => m.id === replying.id) ? '' : ` · ${t('replyDeleted')}`}
                </span>
                <button type="button" className={css.replyCancel} title={t('cancelReply')} aria-label={t('cancelReply')} onClick={cancelReply}>×</button>
              </div>
            )}
            {state.roomId !== undefined && (
              <PendingAttachments
                files={pendingFiles[state.roomId] ?? []}
                removeLabel={t('removeAttachment')}
                onRemove={(index) => {
                  const roomId = state.roomId as number
                  setPendingFiles(previous => ({ ...previous, [roomId]: (previous[roomId] ?? []).filter((_, i) => i !== index) }))
                }}
              />
            )}
            <div className={composing ? `${css.inputSurface} ${css.inputComposing}` : css.inputSurface}>
              <textarea
                ref={inputRef}
                className={css.input}
                rows={1}
                enterKeyHint="send"
                value={draft}
                disabled={state.roomId === undefined || sending[state.roomId] === true}
                placeholder={placeholder}
                role="combobox"
                aria-expanded={popupOpen || slashOpen}
                aria-controls={slashOpen ? 'channel-slash-list' : 'channel-mention-list'}
                aria-autocomplete="list"
                aria-activedescendant={popupOpen ? `channel-mention-${(candidates[selected] as ChannelMember).id}` : slashOpen ? `channel-slash-${slashSelected}` : undefined}
                onChange={(event) => {
                  const roomId = state.roomId
                  const value = event.target.value
                  if (roomId !== undefined) setDrafts(previous => ({ ...previous, [roomId]: value }))
                  setCapabilitiesDismissed(false)
                  setHelpOpen(false)
                  setCaret(event.target.selectionStart)
                  setHighlight(0)
                  setSlashHighlight(0)
                }}
                onSelect={(event) => { setCaret(event.currentTarget.selectionStart) }}
                onScroll={syncInputHighlights}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={onKeyDown}
                onPaste={attach.onPaste}
                onDragOver={attach.onDragOver}
                onDrop={attach.onDrop}
              />
              <div ref={inputHighlightsRef} className={css.inputHighlights} data-composer-highlights aria-hidden="true">
                {splitMentions(draft, visibleMembers).map((segment, index) => segment.member
                  ? <span key={index} className={`${css.mentionBadge} ${css.inputMention}`} data-mention={segment.member.id}>{segment.text}</span>
                  : segment.text)}
                {/* A final empty line must occupy the same line box as in a textarea. */}
                {'\n'}
              </div>
            </div>
            <div className={css.composerToolbar}>
              {attach.button(t('attachButton'), state.roomId === undefined || sending[state.roomId] === true)}
              <button
                type="button"
                className={css.mentionButton}
                title={t('mentionButton')}
                aria-label={t('mentionButton')}
                disabled={state.roomId === undefined || sending[state.roomId] === true}
                onClick={openPicker}
              >
                @
              </button>
              {/* Touch keyboards may not send Enter (or insert a newline instead), so the composer always
                  has a send button, as the desktop chat does; it runs the same submit as Enter. */}
              {stopping !== undefined && <span className={css.stopNote} role="status">{t(stopping.phase === 'stopping' ? 'stopPending' : 'stopDone', { name: stopping.name })}</span>}
              {stopMode ? (
                // #1017: while a bot answers and the draft is empty, the send key stops that bot's reply.
                <button
                  type="button"
                  className={`${css.sendButton} ${css.stopButton}`}
                  title={t('stopReply', { name: (stopTarget ?? stopping)?.name ?? '' })}
                  aria-label={t('stopReply', { name: (stopTarget ?? stopping)?.name ?? '' })}
                  data-phase={stopping?.phase}
                  aria-disabled={stopping?.phase === 'stopping'}
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={stopReply}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
                </button>
              ) : (
                <button
                  type="button"
                  className={css.sendButton}
                  title={t('sendButton')}
                  aria-label={t('sendButton')}
                  disabled={state.roomId === undefined || sending[state.roomId] === true || (draft.trim() === '' && (pendingFiles[state.roomId] ?? []).length === 0)}
                  // Keep focus (and the soft keyboard) in the textarea when tapped.
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={submit}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      {/* #125: the task board's column beside the chat on wide screens (TaskBoard renders into it). */}
      <div ref={setBoardDock} className={css.sideDock} />
      <aside ref={membersRef} className={drawer === 'members' ? `${css.members} ${css.drawerOpen}` : css.members} role={drawer === 'members' ? 'dialog' : undefined} aria-modal={drawer === 'members' ? true : undefined} aria-label={t('activityPanel')} tabIndex={drawer === 'members' ? -1 : undefined}>
        <div className={css.membersHead}><span className={css.membersHeadTitle}>{t('activityPanel')}</span></div>
        <div className={css.drawerTools}>
          {dmWith === undefined && <button type="button" className={css.secondaryButton} onClick={openBoard}>{t('drawerBoard')}</button>}
          <button type="button" className={css.secondaryButton} aria-pressed={scheme === 'dark'} onClick={() => { setScheme(scheme === 'light' ? 'dark' : 'light') }}>{t('drawerDark')}</button>
        </div>
        <button ref={settingsButtonRef} type="button" className={`${css.addMemberButton} ${css.settingsButton}`} disabled={room === undefined} onClick={() => { settingsReturnRef.current = drawer === 'members' ? membersToggleRef.current : settingsButtonRef.current; setDrawer(undefined); setSettingsTab('basic'); setSettingsOpen(true) }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.3-2 .9-2.2-.6-2.5 4.3 1.6 1.7v2.3l-1.6 1.7 2.5 4.3 2.2-.6 2 .9.7 2.3h5l.7-2.3 2-.9 2.2.6 2.5-4.3-1.6-1.7v-2.3l1.6-1.7-2.5-4.3-2.2.6-2-.9L14.5 3Z" /><circle cx="12" cy="12.75" r="3" /></svg>
          {t('channelSettings')}
        </button>
        {activity.length > 0 && (
          <section className={css.activityNow} aria-label={t('activityNow')}>
            <h3 className={css.groupTitle}>{t('activityNow')}</h3>
            {activity.map(a => (
              <button key={a.member.id} type="button" className={css.activityItem} onClick={() => { pickFromList(a.member) }}>
                <Avatar id={a.member.id} name={a.member.name} avatar={a.member.avatar} avatarVersion={a.member.avatarVersion} small />
                <span className={css.activityText}>
                  <span className={css.activityName}>{a.member.name}</span>
                  <span className={css.activityWhat}>{a.task !== undefined ? `#${a.task.id} ${a.task.title}` : t('activityThinking')}{a.room !== undefined && a.room.id !== state.roomId ? ` · ${a.room.name}` : ''}</span>
                </span>
                {a.thinking && <span className={css.activityPulse} aria-hidden />}
              </button>
            ))}
          </section>
        )}
        <button type="button" className={css.addMemberButton} onClick={() => { setDrawer(undefined); setDialog(null) }}>+ {t('addMember')}</button>
        {memberError !== undefined && <div className={css.sendError} role="alert">{memberError}</div>}
        <hr className={css.memberListDivider} />
        <MemberGroup title={t('agents', { count: String(visibleMembers.filter(m => m.kind !== 'human').length) })} members={visibleMembers.filter(m => m.kind !== 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} onDm={dmWith === undefined ? startDm : undefined} t={t} />
        <MemberGroup title={t('humans', { count: String(visibleMembers.filter(m => m.kind === 'human').length) })} members={visibleMembers.filter(m => m.kind === 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
      </aside>
      {settingsOpen && room !== undefined && <ChannelSettingsDialog
        key={room.id}
        room={room}
        members={visibleMembers}
        initialTab={settingsTab}
        effectiveLead={room.effective_lead_id === undefined ? state.effectiveLeadId ?? state.leadId ?? '' : room.effective_lead_id ?? ''}
        renameRoom={renameRoom}
        setDispatchMode={setDispatchMode}
        setMaxRelay={setMaxRelay}
        setLead={setLead}
        setWorkspacePath={setWorkspacePath}
        renewRoom={renewRoom}
        t={t}
        onClose={() => { setSettingsOpen(false) }}
      />}
      {modelsOpen && <div className={css.dialogBackdrop} onClick={() => { setModelsOpen(false) }}>
        <section className={css.dialog} role="dialog" aria-modal="true" aria-label={t('configureModel')} onClick={event => { event.stopPropagation() }}>
          <button type="button" className={css.secondaryButton} onClick={() => { setModelsOpen(false) }}>{t('close')}</button>
          {/* Slot names are global: `settings.section` belongs to the settings shell, and a second
              declaration throws at boot and unmounts the whole shell. Point to Settings → Models instead. */}
          <p>{t('configureModelHint')}</p>
        </section>
      </div>}
      {dialog !== undefined && (
        <MemberDialog
          member={dialog ?? undefined}
          listModels={listModels}
          listClis={listClis}
          listPersonas={listPersonas}
          members={state.members}
          onSubmit={input => (dialog === null ? addMember(input) : updateMember(dialog.id, input))}
          onClose={() => { setDialog(undefined) }}
          t={t}
        />
      )}
    </div>
  )
}
