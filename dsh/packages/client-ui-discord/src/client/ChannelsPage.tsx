/**
 * Channels main panel: room list, message stream with composer, and member
 * list, in a Discord-style three-column layout. All data arrives through the
 * injected `useChannels` hook; posting goes through the injected actions.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { softBreaksToHard } from './softBreaks.ts'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ChannelActions, ChannelMember, ChannelMessage, ChannelQuote, ChannelSnapshot, ChannelTask, OutgoingAttachment } from './channel-source.ts'
import { MAX_MESSAGE_BODY, messageTooLarge } from './channel-source.ts'
import { AttachmentList, PendingAttachments, useComposerAttachments } from './Attachments.tsx'
import { groupRooms } from './channel-source.ts'
import { TaskBoard, TaskCard } from './TaskBoard.tsx'
import { CapabilityList } from './CapabilityList.tsx'
import { activeMention, applyMention, insertMention, rankMembers } from './mention-complete.ts'
import { MemberDialog } from './MemberDialog.tsx'
import { Avatar } from './Avatar.tsx'
import { PermissionCard, type PermissionCardData } from './PermissionCard.tsx'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

/** Injected share: the channel snapshot source and its actions. */
export interface ChannelsInjected extends ChannelActions {
  /** Open shell models, or return false for the standalone web hint. */
  readonly openModelSettings: () => boolean
  readonly hooks: { readonly channels: HostObservable<ChannelSnapshot> }
}

/** Full props of the channels main panel. */
export type ChannelsPageProps = PropsRuntime<'main'> & InjectFace<ChannelsInjected> & PropsLocale<typeof NS>

type T = TranslateNS<typeof NS>

const CLI_TAG = { claude: 'kindClaude', codex: 'kindCodex', gemini: 'kindGemini' } as const

function KindTag({ kind, cli, t }: { kind: ChannelMember['kind'] | undefined; cli?: ChannelMember['cli']; t: T }) {
  if (cli !== undefined) return <span className={css.tag}>{t(CLI_TAG[cli])}</span>
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
function Quote({ quote, t }: { quote: ChannelQuote; t: T }) {
  if (quote.deleted === true) return <div className={`${css.quote} ${css.quoteDeleted}`}>{t('replyDeleted')}</div>
  return (
    <div className={css.quote}>
      <span className={css.quoteAuthor}>{quote.name}</span>
      <span>{quote.text}</span>
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

/** #148: inline editor state for one of your own messages. */
interface OwnActions {
  editing: string | undefined
  onStartEdit: () => void
  onEditChange: (text: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onWithdraw: () => void
}


function MessageRow({ message, member, t, onConfigure, menuOpen, onAvatar, onCloseMenu, onMention, onDecide, onReply, onRetry, retrying, tasks, focused, cardView, onCardView, own }: {
  message: ChannelMessage
  cardView: CardView
  onCardView: (view: CardView) => void
  own: OwnActions | undefined
  tasks: readonly ChannelTask[]
  focused: boolean
  member: ChannelMember | undefined
  t: T
  onConfigure: () => void
  menuOpen: boolean
  onAvatar: () => void
  onCloseMenu: () => void
  onMention: (member: ChannelMember) => void
  onDecide: ChannelActions['decidePermission']
  onReply: (message: ChannelMessage) => void
  onRetry: (messageId: number) => void
  retrying: boolean
}) {
  const labels = useMemo(() => ({ code: { copyLabel: t('copyCode'), copiedLabel: t('copiedCode') }, footnotes: t('footnotes') }), [t])
  let card: { title?: string; state?: string; action?: string; kind?: string; task_id?: number; brief?: string } | undefined
  if (message.card !== null) {
    try { card = JSON.parse(message.card) as { title?: string; state?: string; action?: string; kind?: string; task_id?: number; brief?: string } } catch (error) { void error /* unreadable card metadata: render the text alone */ }
  }
  // Parse once per text change: MessageRow re-renders on every composer keystroke.
  const shown = typeof card?.brief === 'string' && cardView === 'brief' ? card.brief : message.text
  const markdown = useMemo(() => softBreaksToHard(shown), [shown])
  const classes = [css.message, message.author_kind === 'system' ? css.system : '', focused ? css.focused : ''].filter(Boolean).join(' ')
  return (
    <div className={classes} data-message-id={message.id}>
      {member === undefined || message.author_kind === 'system'
        ? <Avatar id={message.author} name={message.name} avatar={member?.avatar} />
        : (
            // Avatar opens this author's member menu; `data-avatar-menu` marks the
            // area an outside press must not land in to keep the menu open.
            <span className={css.avatarAnchor} data-avatar-menu onKeyDown={(event) => { if (event.key === 'Escape') onCloseMenu() }}>
              <button type="button" className={css.avatarButton} aria-label={t('memberMenu', { name: member.name })} aria-haspopup="menu" aria-expanded={menuOpen} onClick={onAvatar}>
                <Avatar id={member.id} name={message.name} avatar={member.avatar} />
              </button>
              {menuOpen && (
                <div className={css.avatarMenu} role="menu" aria-label={t('memberMenu', { name: member.name })}>
                  <div className={css.avatarMenuTitle}>{member.name}</div>
                  <button type="button" role="menuitem" className={css.avatarMenuItem} onClick={() => { onMention(member) }}>{t('avatarMention')}</button>
                </div>
              )}
            </span>
          )}
      <div className={css.messageBody}>
        {message.reply_to !== undefined && <Quote quote={message.reply_to} t={t} />}
        <div className={css.messageHead}>
          <span className={css.author}>{message.name}</span>
          <KindTag kind={member?.kind} cli={member?.cli} t={t} />
          <time className={css.time}>{new Date(message.created_at * 1000).toLocaleString()}</time>
          {message.edited_at !== undefined && <span className={css.edited} title={new Date(message.edited_at * 1000).toLocaleString()}>{t('messageEdited')}</span>}
          {own !== undefined && own.editing === undefined && (
            <span className={css.ownActions}>
              <button type="button" className={css.linkButton} onClick={own.onStartEdit}>{t('messageEdit')}</button>
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
          ? <>{message.text !== '' && <div className={css.text}><MarkdownText text={markdown} labels={labels} /></div>}<AttachmentList attachments={message.attachments} /></>
          : (
              <div className={css.card} data-state={card.state}>
                <div className={css.cardHead}>
                  <div className={css.cardTitle}>{card.title}</div>
                  {/* Only progress cards carry a 简略 rendering; older cards and other kinds show their text as before. */}
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
                <div className={css.text}><MarkdownText text={markdown} labels={labels} /></div>
                {(card.state === 'failed' || card.action === 'configure-model') && (
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
                )}
                {card.kind === 'permission' && <PermissionCard messageId={message.id} card={card as PermissionCardData} t={t} onDecide={onDecide} />}
                {card.kind === 'task' && typeof card.task_id === 'number' && <TaskCard taskId={card.task_id} tasks={tasks} t={t} />}
              </div>
            )}
      </div>
      {/* System notices and progress cards are not conversation turns, so they take no reply. */}
      {message.author_kind !== 'system' && card === undefined && (
        <button type="button" className={css.replyButton} title={t('reply')} aria-label={t('reply')} onClick={() => { onReply(message) }}>↩</button>
      )}
    </div>
  )
}

function MemberGroup({ title, members, busy, onPick, onEdit, onRemove, t }: {
  title: string
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
              <Avatar id={m.id} name={m.name} avatar={m.avatar} small />
              <span className={m.error ? `${css.presence} ${css.errorPresence}` : css.presence} />
            </span>
            <span className={css.memberText}>
              <span className={css.memberName}>{m.name}<KindTag kind={m.kind} cli={m.cli} t={t} /></span>
              <span className={css.memberStatus}>{m.error ? t('memberFailed') : busy.has(m.id) ? t('working') : m.online ? t('online') : t('offline')}</span>
              {m.kind === 'dsh' && m.cli === undefined && (
                <span className={css.memberModel}>{m.model ? `${m.model.provider}/${m.model.model}` : t('defaultModel')}</span>
              )}
            </span>
          </button>
          {m.kind === 'dsh' && (m.editable === true
            ? (
                <span className={css.memberActions}>
                  <button type="button" className={css.linkButton} onClick={() => { onEdit(m) }}>{t('editMember')}</button>
                  <button type="button" className={css.linkButton} onClick={() => { onRemove(m) }}>{t('removeMember')}</button>
                </span>
              )
            : <span className={css.memberActions} title={t('configMember')}>⚙</span>)}
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
export function ChannelsPage({ useChannels, selectRoom, send, createRoom, listModels, listClis, addMember, updateMember, removeMember, setLead, setDispatchMode, setMaxRelay, decidePermission, retryMessage, editMessage, withdrawMessage, openModelSettings, t }: ChannelsPageProps) {
  const state = useChannels(snapshot => snapshot)
  // #148: the own message being edited, and the last edit/withdraw outcome to show.
  const [editing, setEditing] = useState<{ id: number; text: string } | undefined>(undefined)
  const [ownNotice, setOwnNotice] = useState<string | undefined>(undefined)
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
  // Wide-window side columns hidden by the user (#124); narrow windows use the drawers instead.
  const [roomsHidden, setRoomsHidden] = useState(false)
  const [membersHidden, setMembersHidden] = useState(false)
  const [newRoom, setNewRoom] = useState<string | undefined>(undefined)
  const [roomError, setRoomError] = useState<string | undefined>(undefined)
  const [memberError, setMemberError] = useState<string | undefined>(undefined)
  const [retryingId, setRetryingId] = useState<number | undefined>(undefined)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [relayValue, setRelayValue] = useState('6')
  const [relaySaving, setRelaySaving] = useState(false)
  const [relayError, setRelayError] = useState<string | undefined>(undefined)
  useEffect(() => { setSettingsOpen(false); setRelayError(undefined) }, [state.roomId])
  const [modeSaving, setModeSaving] = useState(false)
  const [modeError, setModeError] = useState<string | undefined>(undefined)
  const [leadSaving, setLeadSaving] = useState(false)
  const [leadOpen, setLeadOpen] = useState(false)
  const [capabilitiesDismissed, setCapabilitiesDismissed] = useState(false)
  useEffect(() => { setCapabilitiesDismissed(false) }, [state.roomId])
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
      if (draft === '/' && !capabilitiesDismissed) setCapabilitiesDismissed(true)
    }
    document.addEventListener('mousedown', onPress)
    return () => { document.removeEventListener('mousedown', onPress) }
  }, [draft, capabilitiesDismissed])

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
  const [cardViews, setCardViews] = useState<Record<number, CardView>>({})
  const cardView = state.roomId === undefined ? CARD_VIEW_DEFAULT : cardViews[state.roomId] ?? loadCardView(state.roomId)
  const chooseCardView = (view: CardView): void => {
    if (state.roomId === undefined) return
    const roomId = state.roomId
    saveCardView(roomId, view)
    setCardViews(views => ({ ...views, [roomId]: view }))
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

  // Follow new messages only while the reader is already at the bottom.
  useEffect(() => {
    const log = logRef.current
    if (log !== null && stickRef.current) log.scrollTop = log.scrollHeight
  }, [state.messages, state.roomId])

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
  const openMessage = (roomId: number, messageId: number): void => {
    setDrawer(undefined)
    setJump({ roomId, messageId })
    if (roomId !== state.roomId) void selectRoom(roomId)
  }

  if (state.phase !== 'ready') {
    const notice = state.phase === 'unavailable' ? t('unavailable')
      : state.phase === 'unauthorized' ? t('unauthorized')
        : state.phase === 'error' ? t('error', { message: state.error ?? '' })
          : t('loading')
    return <div className={css.page}><div className={css.notice} role="status">{notice}</div></div>
  }

  const room = state.rooms.find(r => r.id === state.roomId)
  const openTaskOwners = new Set(
    (state.tasks ?? []).filter(t => ['assigned', 'accepted', 'asked', 'rework'].includes(t.status)).map(t => t.owner)
  )
  const busy = new Set([
    ...(state.roomId === undefined ? [] : state.thinking[String(state.roomId)] ?? []),
    ...openTaskOwners,
  ])
  const byId = new Map(state.members.map(m => [m.id, m]))
  const typingNames = (state.roomId === undefined ? [] : state.thinking[String(state.roomId)] ?? []).map(id => byId.get(id)?.name ?? id)
  const mention = activeMention(draft, caret)
  const candidates = mention === undefined || mention.start === dismissedAt ? [] : rankMembers(state.members, mention.query)
  const popupOpen = mention !== undefined && candidates.length > 0
  openMentionAt.current = popupOpen ? mention.start : undefined
  const selected = Math.min(highlight, Math.max(candidates.length - 1, 0))

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
      onStartEdit: () => { setOwnNotice(undefined); setEditing({ id: m.id, text: m.text }) },
      onEditChange: (text) => { setEditing({ id: m.id, text }) },
      onEditCancel: () => { setEditing(undefined) },
      onEditSave: () => {
        if (editing?.id !== m.id || !editing.text.trim()) return
        if (editing.text === m.text) { setEditing(undefined); return }
        editMessage(m.id, editing.text).then(() => { setEditing(undefined) }, (error: unknown) => {
          setOwnNotice(error instanceof Error ? error.message : String(error))
        })
      },
      onWithdraw: () => {
        if (!window.confirm(t('withdrawConfirm'))) return
        setOwnNotice(undefined)
        withdrawMessage(m.id).then(({ stopped, stillRunning }) => {
          const notes = [
            ...(stopped.length > 0 ? [t('withdrawStopped', { names: stopped.join('、') })] : []),
            ...(stillRunning.length > 0 ? [t('withdrawRunning', { names: stillRunning.join('、') })] : []),
          ]
          if (notes.length > 0) setOwnNotice(notes.join('；'))
        }, (error: unknown) => {
          setOwnNotice(error instanceof Error ? error.message : String(error))
        })
      },
    }
  }

  const confirmRemove = (member: ChannelMember): void => {
    if (!window.confirm(t('removeConfirm', { name: member.name }))) return
    setMemberError(undefined)
    removeMember(member.id).catch((error: unknown) => {
      setMemberError(error instanceof Error ? error.message : String(error))
    })
  }

  const changeLead = (id: string): void => {
    setLeadOpen(false)
    if (!id || id === state.leadId || leadSaving) return
    setMemberError(undefined)
    setLeadSaving(true)
    setLead(id).catch((error: unknown) => {
      setMemberError(error instanceof Error ? error.message : String(error))
    }).finally(() => { setLeadSaving(false) })
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

  const submit = (): void => {
    const roomId = state.roomId
    const text = draft.trim()
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
    if (draft === '/' && !capabilitiesDismissed && !isImeEnter(event)) {
      if (event.key === 'Escape') { event.preventDefault(); setCapabilitiesDismissed(true); return }
      if (event.key === 'Enter') { event.preventDefault(); return }
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
    // Same rule as DSH's own editor (dsh-client-ui-primitives: Enter sends unless Shift or an IME
    // is composing; keyCode 229 covers Safari/iOS, which reports composition that way).
    if (event.key === 'Enter' && !event.shiftKey && !isImeEnter(event)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className={[css.page, roomsHidden ? css.roomsHidden : '', membersHidden ? css.membersHidden : ''].filter(Boolean).join(' ')} onKeyDown={event => { if (event.key === 'Escape') setDrawer(undefined) }}>
      {drawer !== undefined && <button className={css.drawerBackdrop} aria-label={t('closeDrawer')} onClick={() => setDrawer(undefined)} />}
      <nav className={drawer === 'rooms' ? `${css.rooms} ${css.drawerOpen}` : css.rooms} aria-label={t('rooms')}>
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
          const showActive = depth === 1 || r.kind === 'workspace' || active > 0
          return (
            <button
              key={r.id}
              type="button"
              className={[css.room, depth === 1 ? css.workspace : '', r.id === state.roomId ? css.roomActive : ''].filter(Boolean).join(' ')}
              aria-current={r.id === state.roomId}
              onClick={() => { stickRef.current = true; setDrawer(undefined); void selectRoom(r.id) }}
            >
              <span className={css.hash} aria-hidden>#</span><span className={css.roomLabel}>{r.name}</span>
              {showActive && <span className={active > 0 ? `${css.activeCount} ${css.activeBusy}` : css.activeCount}>{t('activeTasks', { count: active })}</span>}
            </button>
          )
        })}
      </nav>
      <section className={css.chat}>
        <header className={css.chatHead}>
          <button type="button" className={css.mobileButton} aria-label={t('showRooms')} aria-expanded={drawer === 'rooms'} onClick={() => setDrawer(drawer === 'rooms' ? undefined : 'rooms')}>☰</button>
          <button type="button" className={css.panelToggle} title={t(roomsHidden ? 'expandRooms' : 'collapseRooms')} aria-label={t(roomsHidden ? 'expandRooms' : 'collapseRooms')} aria-expanded={!roomsHidden} onClick={() => { setRoomsHidden(!roomsHidden) }}>{roomsHidden ? '»' : '«'}</button>
          <span className={css.hash} aria-hidden>#</span><span className={css.roomName}>{room?.name}</span>
          <button type="button" className={css.secondaryButton} disabled={state.roomId === undefined} onClick={() => {
            setRelayValue(String(room?.max_relay ?? 6)); setRelayError(undefined); setSettingsOpen(true)
          }}>{t('channelSettings')}</button>
          <button type="button" className={`${css.panelToggle} ${css.panelToggleEnd}`} title={t(membersHidden ? 'expandMembers' : 'collapseMembers')} aria-label={t(membersHidden ? 'expandMembers' : 'collapseMembers')} aria-expanded={!membersHidden} onClick={() => { setMembersHidden(!membersHidden) }}>{membersHidden ? '«' : '»'}</button>
          <button type="button" className={css.mobileButton} aria-label={t('showMembers')} aria-expanded={drawer === 'members'} onClick={() => setDrawer(drawer === 'members' ? undefined : 'members')}>{t('membersButton')}</button>
        </header>
        <div
          ref={logRef}
          className={css.log}
          role="log"
          aria-live="polite"
          onScroll={(event) => {
            const el = event.currentTarget
            stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
          }}
        >
          {!state.members.some(m => m.kind !== 'human') && (
            <div className={css.guide}>
              <div>{t('guideNoMembers')}</div>
              <button type="button" className={css.primaryButton} onClick={() => { setDialog(null) }}>{t('addMember')}</button>
            </div>
          )}
          {state.messages.length === 0
            ? <div className={css.empty}>{t('empty')}</div>
            : state.messages.map(m => (
                <MessageRow
                  key={m.id}
                  message={m}
                  member={byId.get(m.author)}
                  t={t}
                  onConfigure={() => { if (!openModelSettings()) setModelsOpen(true) }}
                  menuOpen={avatarMenu === m.id}
                  cardView={cardView}
                  onCardView={chooseCardView}
                  onAvatar={() => { setAvatarMenu(avatarMenu === m.id ? undefined : m.id) }}
                  onCloseMenu={() => { setAvatarMenu(undefined) }}
                  onMention={mentionFromAvatar}
                  onDecide={decidePermission}
                  onRetry={handleRetry}
                  retrying={retryingId === m.id}
                  tasks={state.tasks ?? []}
                  focused={focusedId === m.id}
                  onReply={startReply}
                  own={ownActions(m)}
                />
              ))}
        </div>
        <div className={css.working} aria-live="polite">{typingNames.length > 0 ? t('workingList', { names: typingNames.join('、') }) : ''}</div>
        <div className={css.composer} ref={composerRef}>
          {draft === '/' && !capabilitiesDismissed && <CapabilityList key={state.roomId} t={t} onClose={() => { setCapabilitiesDismissed(true) }} />}
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
                      <Avatar id={m.id} name={m.name} avatar={m.avatar} small />
                      {m.online && <span className={m.error ? `${css.presence} ${css.errorPresence}` : css.presence} />}
                    </span>
                    <span className={css.mentionName}>{m.name}</span>
                    <KindTag kind={m.kind} cli={m.cli} t={t} />
                    <span className={css.mentionMeta}>
                      {m.error ? t('memberFailed') : busy.has(m.id) ? t('working') : m.online ? `@${m.id}` : t('offline')}
                    </span>
                  </div>
                ))}
              </div>
              <div className={css.mentionHint}>{t('mentionHint')}</div>
            </div>
          )}
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
          <div className={css.composerRow}>
            <textarea
              ref={inputRef}
              className={css.input}
              rows={1}
              enterKeyHint="send"
              value={draft}
              disabled={state.roomId === undefined || sending[state.roomId] === true}
              placeholder={t(compactComposer() ? 'placeholderShort' : 'placeholder', { room: room?.name ?? '' })}
              role="combobox"
              aria-expanded={popupOpen}
              aria-controls="channel-mention-list"
              aria-autocomplete="list"
              aria-activedescendant={popupOpen ? `channel-mention-${(candidates[selected] as ChannelMember).id}` : undefined}
              onChange={(event) => {
                const roomId = state.roomId
                const value = event.target.value
                if (roomId !== undefined) setDrafts(previous => ({ ...previous, [roomId]: value }))
                setCapabilitiesDismissed(false)
                setCaret(event.target.selectionStart)
                setHighlight(0)
              }}
              onSelect={(event) => { setCaret(event.currentTarget.selectionStart) }}
              onKeyDown={onKeyDown}
              onPaste={attach.onPaste}
              onDragOver={attach.onDragOver}
              onDrop={attach.onDrop}
            />
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
              {t('sendButton')}
            </button>
          </div>
        </div>
      </section>
      <aside className={drawer === 'members' ? `${css.members} ${css.drawerOpen}` : css.members}>
        <TaskBoard tasks={state.tasks ?? []} rooms={state.rooms} chatId={state.taskChat} roomId={state.roomId} t={t} onOpen={openMessage} />
        <div className={css.leadControl}>
          <span className={css.fieldLabel}>{t('lead')}</span>
          <button
            type="button"
            className={css.fieldInput}
            aria-haspopup="listbox"
            aria-expanded={leadOpen}
            aria-label={t('lead')}
            disabled={leadSaving || state.members.every(m => m.kind === 'human')}
            onClick={() => { setLeadOpen(!leadOpen) }}
          >
            {state.members.find(m => m.id === (state.effectiveLeadId ?? state.leadId))?.name ?? t('leadNone')}
          </button>
          {leadOpen && <div className={css.leadMenu} role="listbox" aria-label={t('lead')}>
            {state.members.filter(m => m.kind !== 'human').map(m => (
              <button key={m.id} type="button" role="option" aria-selected={m.id === state.leadId} className={css.leadOption} onClick={() => { changeLead(m.id) }}>{m.name}</button>
            ))}
          </div>}
        </div>
        <fieldset disabled={modeSaving || state.roomId === undefined}>
          <legend>{t('dispatchMode')}</legend>
          {(['solo', 'team', 'mixed'] as const).map(mode => <label key={mode} style={{ display: 'block' }}>
            <input type="radio" name="dispatch-mode" value={mode}
              checked={(state.rooms.find(r => r.id === state.roomId)?.dispatch_mode ?? 'mixed') === mode}
              onChange={() => {}}
              onClick={() => {
                const roomId = state.roomId
                if (roomId === undefined) return
                setModeSaving(true); setModeError(undefined)
                setDispatchMode(roomId, mode).catch((error: unknown) => { setModeError(error instanceof Error ? error.message : String(error)) }).finally(() => { setModeSaving(false) })
              }} />
            {t(mode === 'solo' ? 'dispatchSolo' : mode === 'team' ? 'dispatchTeam' : 'dispatchMixed')}
          </label>)}
        </fieldset>
        {modeError !== undefined && <div role="alert">{modeError}</div>}
        <button type="button" className={css.addMemberButton} onClick={() => { setDrawer(undefined); setDialog(null) }}>+ {t('addMember')}</button>
        {memberError !== undefined && <div className={css.sendError} role="alert">{memberError}</div>}
        <MemberGroup title={t('agents', { count: String(state.members.filter(m => m.kind !== 'human').length) })} members={state.members.filter(m => m.kind !== 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
        <MemberGroup title={t('humans', { count: String(state.members.filter(m => m.kind === 'human').length) })} members={state.members.filter(m => m.kind === 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
      </aside>
      {settingsOpen && <div className={css.dialogBackdrop} onClick={() => { if (!relaySaving) setSettingsOpen(false) }}>
        <form className={css.dialog} role="dialog" aria-modal="true" aria-label={t('channelSettings')} onClick={event => { event.stopPropagation() }} onSubmit={event => {
          event.preventDefault()
          const roomId = state.roomId
          const value = Number(relayValue)
          if (roomId === undefined || relaySaving) return
          if (!Number.isInteger(value) || value < 6 || value > 20) { setRelayError(t('relayInvalid')); return }
          setRelaySaving(true); setRelayError(undefined)
          setMaxRelay(roomId, value).then(() => { setSettingsOpen(false) }).catch((error: unknown) => {
            setRelayError(error instanceof Error ? error.message : String(error))
          }).finally(() => { setRelaySaving(false) })
        }}>
          <h2>{t('channelSettings')}</h2>
          <label className={css.fieldLabel}>{t('maxRelay')}
            <input className={css.fieldInput} type="number" min={6} max={20} step={1} required value={relayValue} disabled={relaySaving} onChange={event => { setRelayValue(event.target.value) }} />
          </label>
          <p>{t('relayHint')}</p>
          {relayError !== undefined && <div role="alert">{relayError}</div>}
          <button type="submit" className={css.primaryButton} disabled={relaySaving}>{t('save')}</button>
          <button type="button" className={css.secondaryButton} disabled={relaySaving} onClick={() => { setSettingsOpen(false) }}>{t('close')}</button>
        </form>
      </div>}
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
          onSubmit={input => (dialog === null ? addMember(input) : updateMember(dialog.id, input))}
          onClose={() => { setDialog(undefined) }}
          t={t}
        />
      )}
    </div>
  )
}
