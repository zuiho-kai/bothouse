/**
 * Channels main panel: room list, message stream with composer, and member
 * list, in a Discord-style three-column layout. All data arrives through the
 * injected `useChannels` hook; posting goes through the injected actions.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ChannelActions, ChannelMember, ChannelMessage, ChannelSnapshot, RoomMemberEntry } from './channel-source.ts'
import { activeMention, applyMention, insertMention, rankMembers } from './mention-complete.ts'
import { MemberDialog } from './MemberDialog.tsx'
import { CreateRoomDialog } from './CreateRoomDialog.tsx'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

/** Injected share: the channel snapshot source and its actions. */
export interface ChannelsInjected extends ChannelActions {
  readonly hooks: { readonly channels: HostObservable<ChannelSnapshot> }
}

/** Full props of the channels main panel. */
export type ChannelsPageProps = PropsRuntime<'main'> & InjectFace<ChannelsInjected> & PropsLocale<typeof NS>

type T = TranslateNS<typeof NS>

const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#e67e22']

function color(id: string): string {
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as string
}

function Avatar({ id, name, small }: { id: string; name: string; small?: boolean }) {
  return (
    <span className={small === true ? `${css.avatar} ${css.avatarSmall}` : css.avatar} style={{ background: color(id) }} aria-hidden>
      {(name || id).slice(0, 1)}
    </span>
  )
}

function KindTag({ kind, t }: { kind: ChannelMember['kind'] | undefined; t: T }) {
  if (kind === 'dsh') return <span className={css.tag}>{t('kindDsh')}</span>
  if (kind === 'bot') return <span className={css.tag}>{t('kindBot')}</span>
  return null
}

function MessageRow({
  message,
  member,
  t,
  onContinue,
  isContinuing,
  isResumed,
  relayError,
}: {
  message: ChannelMessage
  member: ChannelMember | undefined
  t: T
  onContinue: (roomId: number, messageId: number) => void
  isContinuing: boolean
  isResumed: boolean
  relayError: string | undefined
}) {
  let card: { title?: string; state?: string; type?: string; room_id?: number } | undefined
  if (message.card !== null) {
    try { card = JSON.parse(message.card) as { title?: string; state?: string; type?: string; room_id?: number } } catch (error) { void error /* unreadable card metadata: render the text alone */ }
  }
  return (
    <div className={message.author_kind === 'system' ? `${css.message} ${css.system}` : css.message}>
      <Avatar id={message.author} name={message.name} />
      <div className={css.messageBody}>
        <div className={css.messageHead}>
          <span className={css.author}>{message.name}</span>
          <KindTag kind={member?.kind} t={t} />
          <time className={css.time}>{new Date(message.created_at * 1000).toLocaleString()}</time>
        </div>
        {card === undefined
          ? <div className={css.text}>{message.text}</div>
          : card.type === 'relay_limit'
            ? (
                <div className={`${css.card} ${css.relayCard}`} data-type="relay_limit">
                  <div className={css.relayCardBody}>
                    <div className={css.relayCardText}>{message.text}</div>
                    <button
                      type="button"
                      className={css.continueButton}
                      title={t('continueRoomTitle')}
                      aria-label={t('continueRoom')}
                      disabled={isContinuing || isResumed}
                      onClick={() => { onContinue(card?.room_id ?? message.room_id, message.id) }}
                    >
                      {isContinuing ? t('continuingRoom') : isResumed ? t('continueResumed') : t('continueRoom')}
                    </button>
                  </div>
                  {relayError !== undefined && (
                    <div className={css.cardError} role="alert">{relayError}</div>
                  )}
                </div>
              )
            : (
                <div className={css.card} data-state={card.state}>
                  {card.title !== undefined && <div className={css.cardTitle}>{card.title}</div>}
                  <div className={css.text}>{message.text}</div>
                </div>
              )}
      </div>
    </div>
  )
}

function MemberGroup({
  title,
  members,
  busy,
  onPick,
  onEdit,
  onRemove,
  t,
  onAddToRoom,
  onRemoveFromRoom,
  roomRole,
}: {
  title: string
  members: readonly ChannelMember[]
  busy: ReadonlySet<string>
  onPick: (member: ChannelMember) => void
  onEdit?: (member: ChannelMember) => void
  onRemove?: (member: ChannelMember) => void
  t: T
  onAddToRoom?: (member: ChannelMember) => void
  onRemoveFromRoom?: (member: ChannelMember) => void
  roomRole?: (member: ChannelMember) => 'owner' | 'member' | undefined
}) {
  if (members.length === 0) return null
  return (
    <>
      <h3 className={css.groupTitle}>{title}</h3>
      {members.map(m => {
        const role = roomRole ? roomRole(m) : undefined
        return (
          <div key={m.id} className={m.online ? css.memberRow : `${css.memberRow} ${css.offline}`}>
            <button
              type="button"
              className={css.member}
              title={t('mentionPick', { name: m.name })}
              onClick={() => { onPick(m) }}
            >
              <span className={css.memberAvatar}>
                <Avatar id={m.id} name={m.name} small />
                <span className={css.presence} />
              </span>
              <span className={css.memberText}>
                <span className={css.memberName}>{m.name}<KindTag kind={m.kind} t={t} /></span>
                <span className={css.memberStatus}>{busy.has(m.id) ? t('working') : m.online ? t('online') : t('offline')}</span>
                {m.kind === 'dsh' && (
                  <span className={css.memberModel}>{m.model ? `${m.model.provider}/${m.model.model}` : t('defaultModel')}</span>
                )}
              </span>
            </button>
            {onAddToRoom !== undefined && (
              <span className={css.memberActionsAlways}>
                <button
                  type="button"
                  className={css.actionButton}
                  title={t('addToRoom')}
                  onClick={() => { onAddToRoom(m) }}
                >
                  + {t('addToRoom')}
                </button>
              </span>
            )}
            {onRemoveFromRoom !== undefined && (
              <span className={css.memberActionsAlways}>
                {role === 'owner' || m.id === 'owner' ? (
                  <span className={css.ownerBadge} title={t('cannotRemoveOwner')}>{t('roomOwner')}</span>
                ) : (
                  <button
                    type="button"
                    className={`${css.actionButton} ${css.removeButton}`}
                    title={t('removeFromRoom')}
                    onClick={() => { onRemoveFromRoom(m) }}
                  >
                    {t('removeFromRoom')}
                  </button>
                )}
              </span>
            )}
            {onAddToRoom === undefined && onRemoveFromRoom === undefined && m.kind === 'dsh' && (m.editable === true
              ? (
                  <span className={css.memberActions}>
                    <button type="button" className={css.linkButton} onClick={() => { onEdit?.(m) }}>{t('editMember')}</button>
                    <button type="button" className={css.linkButton} onClick={() => { onRemove?.(m) }}>{t('removeMember')}</button>
                  </span>
                )
              : <span className={css.memberActions} title={t('configMember')}>⚙</span>)}
          </div>
        )
      })}
    </>
  )
}

/**
 * Render the channels panel.
 * @param props - framework, injected, and locale shares.
 * @returns the three-column channel view.
 */
export function ChannelsPage({
  useChannels, selectRoom, send, createRoom, listModels, addMember, updateMember, removeMember, stopRoom, continueRoom,
  getRoomMembers, addRoomMember, removeRoomMember, t,
}: ChannelsPageProps) {
  const state = useChannels(snapshot => snapshot)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string | undefined>>({})
  const [sending, setSending] = useState<Record<number, boolean>>({})
  const [stoppingRoom, setStoppingRoom] = useState<Record<number, boolean>>({})
  const [stopNotice, setStopNotice] = useState<Record<number, string | undefined>>({})
  const [continuingMessages, setContinuingMessages] = useState<Record<number, boolean>>({})
  const [resumedMessages, setResumedMessages] = useState<Record<number, boolean>>({})
  const [relayErrors, setRelayErrors] = useState<Record<number, string | undefined>>({})
  const pendingRooms = useRef(new Set<number>())
  const draft = state.roomId === undefined ? '' : drafts[state.roomId] ?? ''
  const sendError = state.roomId === undefined ? undefined : errors[state.roomId]
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
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const [roomMembers, setRoomMembers] = useState<readonly RoomMemberEntry[]>([])
  const [roomError, setRoomError] = useState<string | undefined>(undefined)
  const [memberError, setMemberError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const input = inputRef.current
    const next = pendingCaret.current
    if (input === null || next === undefined) return
    pendingCaret.current = undefined
    input.focus()
    input.setSelectionRange(next, next)
  })

  // Follow new messages only while the reader is already at the bottom.
  useEffect(() => {
    const log = logRef.current
    if (log !== null && stickRef.current) log.scrollTop = log.scrollHeight
  }, [state.messages, state.roomId])

  const currentRoom = state.rooms.find(r => r.id === state.roomId)
  useEffect(() => {
    const rid = state.roomId
    if (state.phase === 'ready' && rid !== undefined && currentRoom?.visibility === 'private' && typeof getRoomMembers === 'function') {
      let cancelled = false
      getRoomMembers(rid).then(entries => {
        if (!cancelled) setRoomMembers(entries)
      }).catch((err: unknown) => {
        if (!cancelled) setMemberError(err instanceof Error ? err.message : String(err))
      })
      return () => { cancelled = true }
    } else {
      setRoomMembers([])
    }
  }, [state.phase, state.roomId, currentRoom?.visibility, getRoomMembers])

  if (state.phase !== 'ready') {
    const notice = state.phase === 'unavailable' ? t('unavailable')
      : state.phase === 'unauthorized' ? t('unauthorized')
        : state.phase === 'error' ? t('error', { message: state.error ?? '' })
          : t('loading')
    return <div className={css.page}><div className={css.notice} role="status">{notice}</div></div>
  }

  const room = state.rooms.find(r => r.id === state.roomId)
  const busy = new Set(state.roomId === undefined ? [] : state.thinking[String(state.roomId)] ?? [])
  const byId = new Map(state.members.map(m => [m.id, m]))
  const busyNames = [...busy].map(id => byId.get(id)?.name ?? id)
  const mention = activeMention(draft, caret)
  const candidates = mention === undefined || mention.start === dismissedAt ? [] : rankMembers(state.members, mention.query)
  const popupOpen = mention !== undefined && candidates.length > 0
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
    const next = insertMention(draft, caret, member)
    setDraft(next.text, next.caret)
  }

  const handleCreateRoom = async (name: string, visibility: 'public' | 'private', initialMembers?: readonly string[]): Promise<void> => {
    setRoomError(undefined)
    if (visibility === 'private' || (initialMembers && initialMembers.length > 0)) {
      await createRoom(name, visibility, initialMembers)
    } else {
      await createRoom(name)
    }
  }

  const roomMemberIdSet = new Set(roomMembers.map(m => m.member_id))
  if (room?.visibility === 'private') {
    roomMemberIdSet.add('owner')
  }
  const roomRoleMap = new Map<string, 'owner' | 'member'>()
  for (const entry of roomMembers) {
    roomRoleMap.set(entry.member_id, entry.role)
  }
  roomRoleMap.set('owner', 'owner')

  const roomMembersList: ChannelMember[] = []
  const availableMembersList: ChannelMember[] = []

  for (const m of state.members) {
    if (roomMemberIdSet.has(m.id)) {
      roomMembersList.push(m)
    } else {
      availableMembersList.push(m)
    }
  }

  roomMembersList.sort((a, b) => {
    if (a.id === 'owner') return -1
    if (b.id === 'owner') return 1
    return 0
  })

  const handleAddToRoom = (member: ChannelMember): void => {
    const rid = state.roomId
    if (rid === undefined || typeof addRoomMember !== 'function') return
    setMemberError(undefined)
    addRoomMember(rid, member.id).then(() => {
      if (typeof getRoomMembers === 'function') {
        return getRoomMembers(rid).then(setRoomMembers)
      } else {
        setRoomMembers(prev => [...prev, { member_id: member.id, role: 'member' }])
      }
    }).catch((error: unknown) => {
      setMemberError(error instanceof Error ? error.message : String(error))
    })
  }

  const handleRemoveFromRoom = (member: ChannelMember): void => {
    const rid = state.roomId
    if (rid === undefined || typeof removeRoomMember !== 'function') return
    if (member.id === 'owner' || roomRoleMap.get(member.id) === 'owner') return
    if (!window.confirm(t('removeFromRoomConfirm', { name: member.name }))) return
    setMemberError(undefined)
    removeRoomMember(rid, member.id).then(() => {
      if (typeof getRoomMembers === 'function') {
        return getRoomMembers(rid).then(setRoomMembers)
      } else {
        setRoomMembers(prev => prev.filter(m => m.member_id !== member.id))
      }
    }).catch((error: unknown) => {
      setMemberError(error instanceof Error ? error.message : String(error))
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

  const submit = (): void => {
    const roomId = state.roomId
    const text = draft.trim()
    if (!text || roomId === undefined || pendingRooms.current.has(roomId)) return
    pendingRooms.current.add(roomId)
    setSending(previous => ({ ...previous, [roomId]: true }))
    setErrors(previous => ({ ...previous, [roomId]: undefined }))
    stickRef.current = true
    send(text).then(() => {
      setDrafts(previous => ({ ...previous, [roomId]: '' }))
    }).catch((error: unknown) => {
      setErrors(previous => ({ ...previous, [roomId]: t('sendFailed', { message: error instanceof Error ? error.message : String(error) }) }))
    }).finally(() => {
      pendingRooms.current.delete(roomId)
      setSending(previous => ({ ...previous, [roomId]: false }))
    })
  }

  const handleStop = (roomId: number): void => {
    if (stoppingRoom[roomId] === true) return
    const currentlyBusy = new Set(state.thinking[String(roomId)] ?? [])
    setStoppingRoom(previous => ({ ...previous, [roomId]: true }))
    setStopNotice(previous => ({ ...previous, [roomId]: undefined }))
    stopRoom(roomId).then((res) => {
      if (res.stopped_members.length === 0) {
        setStopNotice(previous => ({ ...previous, [roomId]: t('stopNone') }))
      } else {
        const parts: string[] = []
        const confirmed = res.stopped_members.filter(m => m.outcome === 'confirmed')
        const requested = res.stopped_members.filter(m => m.outcome === 'requested')
        const unsupported = res.stopped_members.filter(m => m.outcome === 'unsupported')

        const stopped = confirmed.filter(m => currentlyBusy.has(m.member))
        const notRunning = confirmed.filter(m => !currentlyBusy.has(m.member))

        if (stopped.length > 0) {
          const names = stopped.map(m => byId.get(m.member)?.name ?? m.member).join('、')
          parts.push(t('stopConfirmed', { names }))
        }
        if (requested.length > 0) {
          const names = requested.map(m => byId.get(m.member)?.name ?? m.member).join('、')
          parts.push(t('stopRequested', { names }))
        }
        if (unsupported.length > 0) {
          const names = unsupported.map(m => byId.get(m.member)?.name ?? m.member).join('、')
          parts.push(t('stopUnsupported', { names }))
        }
        if (notRunning.length > 0) {
          const names = notRunning.map(m => byId.get(m.member)?.name ?? m.member).join('、')
          parts.push(t('stopNotRunning', { names }))
        }
        setStopNotice(previous => ({ ...previous, [roomId]: parts.length ? parts.join('；') : t('stopNone') }))
      }
    }).catch((error: unknown) => {
      setStopNotice(previous => ({
        ...previous,
        [roomId]: t('stopFailed', { message: error instanceof Error ? error.message : String(error) }),
      }))
    }).finally(() => {
      setStoppingRoom(previous => ({ ...previous, [roomId]: false }))
    })
  }

  const handleContinue = (targetRoomId: number, messageId: number): void => {
    if (continuingMessages[messageId] === true || resumedMessages[messageId] === true) return
    setContinuingMessages(previous => ({ ...previous, [messageId]: true }))
    setRelayErrors(previous => ({ ...previous, [messageId]: undefined }))
    continueRoom(targetRoomId).then(() => {
      setResumedMessages(previous => ({ ...previous, [messageId]: true }))
    }).catch((error: unknown) => {
      setRelayErrors(previous => ({
        ...previous,
        [messageId]: t('continueFailed', { message: error instanceof Error ? error.message : String(error) }),
      }))
    }).finally(() => {
      setContinuingMessages(previous => ({ ...previous, [messageId]: false }))
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (popupOpen && !event.nativeEvent.isComposing) {
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
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className={css.page}>
      <nav className={css.rooms} aria-label={t('rooms')}>
        <div className={css.groupHead}>
          <h3 className={css.groupTitle}>{t('rooms')}</h3>
          <button
            type="button"
            className={css.iconButton}
            title={t('newRoom')}
            aria-label={t('newRoom')}
            onClick={() => { setCreateRoomOpen(true); setRoomError(undefined) }}
          >
            +
          </button>
        </div>
        {roomError !== undefined && <div className={css.sendError} role="alert">{roomError}</div>}
        {state.rooms.map(r => (
          <button
            key={r.id}
            type="button"
            className={r.id === state.roomId ? `${css.room} ${css.roomActive}` : css.room}
            aria-current={r.id === state.roomId}
            onClick={() => { stickRef.current = true; void selectRoom(r.id) }}
          >
            <span className={css.hash} aria-hidden>#</span>
            {r.visibility === 'private' && (
              <span className={css.lockIcon} title={t('privateBadge')} aria-label={t('privateBadge')}>🔒</span>
            )}
            {r.name}
          </button>
        ))}
      </nav>
      <section className={css.chat}>
        <header className={css.chatHead}>
          <div className={css.chatHeadTitle}>
            <span className={css.hash} aria-hidden>#</span>
            {room?.visibility === 'private' && (
              <span className={css.headerLock} title={t('privateBadge')} aria-label={t('privateBadge')}>🔒</span>
            )}
            {room?.name}
            {room?.visibility === 'private' && (
              <span className={css.privateBadge}>{t('privateBadge')}</span>
            )}
          </div>
          {state.roomId !== undefined && (
            <div className={css.chatHeadActions}>
              <button
                type="button"
                className={css.stopButton}
                title={t('stopRoomTitle')}
                aria-label={t('stopRoom')}
                disabled={stoppingRoom[state.roomId] === true}
                onClick={() => { handleStop(state.roomId as number) }}
              >
                <span className={css.stopIcon} aria-hidden />
                <span>{stoppingRoom[state.roomId] ? t('stoppingRoom') : t('stopRoom')}</span>
              </button>
            </div>
          )}
        </header>
        {state.roomId !== undefined && stopNotice[state.roomId] !== undefined && (
          <div className={css.roomNotice} role="status" aria-live="polite">
            <span className={css.roomNoticeText}>{stopNotice[state.roomId]}</span>
            <button
              type="button"
              className={css.noticeClose}
              title={t('closeNotice')}
              aria-label={t('closeNotice')}
              onClick={() => {
                const rid = state.roomId as number
                setStopNotice(previous => ({ ...previous, [rid]: undefined }))
              }}
            >
              ×
            </button>
          </div>
        )}
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
          {state.messages.length === 0
            ? <div className={css.empty}>{t('empty')}</div>
            : state.messages.map(m => (
                <MessageRow
                  key={m.id}
                  message={m}
                  member={byId.get(m.author)}
                  t={t}
                  onContinue={handleContinue}
                  isContinuing={continuingMessages[m.id] === true}
                  isResumed={resumedMessages[m.id] === true}
                  relayError={relayErrors[m.id]}
                />
              ))}
        </div>
        <div className={css.working} aria-live="polite">{busyNames.length > 0 ? t('workingList', { names: busyNames.join('、') }) : ''}</div>
        <div className={css.composer}>
          {sendError !== undefined && <div className={css.sendError} role="alert">{sendError}</div>}
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
                      <Avatar id={m.id} name={m.name} small />
                      {m.online && <span className={css.presence} />}
                    </span>
                    <span className={css.mentionName}>{m.name}</span>
                    <KindTag kind={m.kind} t={t} />
                    <span className={css.mentionMeta}>
                      {busy.has(m.id) ? t('working') : m.online ? `@${m.id}` : t('offline')}
                    </span>
                  </div>
                ))}
              </div>
              <div className={css.mentionHint}>{t('mentionHint')}</div>
            </div>
          )}
          <div className={css.composerRow}>
            <textarea
              ref={inputRef}
              className={css.input}
              rows={1}
              value={draft}
              disabled={state.roomId === undefined || sending[state.roomId] === true}
              placeholder={t('placeholder', { room: room?.name ?? '' })}
              role="combobox"
              aria-expanded={popupOpen}
              aria-controls="channel-mention-list"
              aria-autocomplete="list"
              aria-activedescendant={popupOpen ? `channel-mention-${(candidates[selected] as ChannelMember).id}` : undefined}
              onChange={(event) => {
                const roomId = state.roomId
                const value = event.target.value
                if (roomId !== undefined) setDrafts(previous => ({ ...previous, [roomId]: value }))
                setCaret(event.target.selectionStart)
                setHighlight(0)
              }}
              onSelect={(event) => { setCaret(event.currentTarget.selectionStart) }}
              onKeyDown={onKeyDown}
            />
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
          </div>
        </div>
      </section>
      <aside className={css.members}>
        <button type="button" className={css.addMemberButton} onClick={() => { setDialog(null) }}>+ {t('addMember')}</button>
        {memberError !== undefined && <div className={css.sendError} role="alert">{memberError}</div>}
        {room?.visibility === 'private' ? (
          <>
            <MemberGroup
              title={t('inThisRoom', { count: String(roomMembersList.length) })}
              members={roomMembersList}
              busy={busy}
              onPick={pickFromList}
              onRemoveFromRoom={handleRemoveFromRoom}
              roomRole={m => roomRoleMap.get(m.id)}
              t={t}
            />
            <MemberGroup
              title={t('availableMembers', { count: String(availableMembersList.length) })}
              members={availableMembersList}
              busy={busy}
              onPick={pickFromList}
              onAddToRoom={handleAddToRoom}
              t={t}
            />
          </>
        ) : (
          <>
            <MemberGroup title={t('agents', { count: String(state.members.filter(m => m.kind !== 'human').length) })} members={state.members.filter(m => m.kind !== 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
            <MemberGroup title={t('humans', { count: String(state.members.filter(m => m.kind === 'human').length) })} members={state.members.filter(m => m.kind === 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
          </>
        )}
      </aside>
      {dialog !== undefined && (
        <MemberDialog
          member={dialog ?? undefined}
          listModels={listModels}
          onSubmit={input => (dialog === null ? addMember(input) : updateMember(dialog.id, input))}
          onClose={() => { setDialog(undefined) }}
          t={t}
        />
      )}
      {createRoomOpen && (
        <CreateRoomDialog
          members={state.members}
          onSubmit={handleCreateRoom}
          onClose={() => { setCreateRoomOpen(false) }}
          t={t}
        />
      )}
    </div>
  )
}
