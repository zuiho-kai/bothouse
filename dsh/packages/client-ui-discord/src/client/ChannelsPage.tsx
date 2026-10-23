/**
 * Channels main panel: room list, message stream with composer, and member
 * list, in a Discord-style three-column layout. All data arrives through the
 * injected `useChannels` hook; posting goes through the injected actions.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ChannelActions, ChannelMember, ChannelMessage, ChannelSnapshot } from './channel-source.ts'
import { activeMention, applyMention, insertMention, rankMembers } from './mention-complete.ts'
import { MemberDialog } from './MemberDialog.tsx'
import { Avatar } from './Avatar.tsx'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

/** Injected share: the channel snapshot source and its actions. */
export interface ChannelsInjected extends ChannelActions {
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

function MessageRow({ message, member, t, onConfigure }: { message: ChannelMessage; member: ChannelMember | undefined; t: T; onConfigure: () => void }) {
  let card: { title?: string; state?: string; action?: string } | undefined
  if (message.card !== null) {
    try { card = JSON.parse(message.card) as { title?: string; state?: string; action?: string } } catch (error) { void error /* unreadable card metadata: render the text alone */ }
  }
  return (
    <div className={message.author_kind === 'system' ? `${css.message} ${css.system}` : css.message}>
      <Avatar id={message.author} name={message.name} avatar={member?.avatar} />
      <div className={css.messageBody}>
        <div className={css.messageHead}>
          <span className={css.author}>{message.name}</span>
          <KindTag kind={member?.kind} cli={member?.cli} t={t} />
          <time className={css.time}>{new Date(message.created_at * 1000).toLocaleString()}</time>
        </div>
        {card === undefined
          ? <div className={css.text}>{message.text}</div>
          : (
              <div className={css.card} data-state={card.state}>
                <div className={css.cardTitle}>{card.title}</div>
                <div className={css.text}>{message.text}</div>
                {card.action === 'configure-model' && <button type="button" className={css.secondaryButton} onClick={onConfigure}>{t('configureModel')}</button>}
              </div>
            )}
      </div>
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
export function ChannelsPage({ useChannels, selectRoom, send, createRoom, listModels, listClis, addMember, updateMember, removeMember, renderSlot, t }: ChannelsPageProps) {
  const state = useChannels(snapshot => snapshot)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [errors, setErrors] = useState<Record<number, string | undefined>>({})
  const [sending, setSending] = useState<Record<number, boolean>>({})
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
  const [modelsOpen, setModelsOpen] = useState(false)
  const [drawer, setDrawer] = useState<'rooms' | 'members' | undefined>(undefined)
  // Wide-window side columns hidden by the user (#124); narrow windows use the drawers instead.
  const [roomsHidden, setRoomsHidden] = useState(false)
  const [membersHidden, setMembersHidden] = useState(false)
  const [newRoom, setNewRoom] = useState<string | undefined>(undefined)
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
    setDrawer(undefined)
    const next = insertMention(draft, caret, member)
    setDraft(next.text, next.caret)
  }

  const submitRoom = (): void => {
    const name = (newRoom ?? '').trim()
    if (!name) { setNewRoom(undefined); return }
    setRoomError(undefined)
    createRoom(name).then(() => { setNewRoom(undefined) }).catch((error: unknown) => {
      setRoomError(error instanceof Error ? error.message : String(error))
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
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submitRoom() }
              if (event.key === 'Escape') { setNewRoom(undefined); setRoomError(undefined) }
            }}
            onBlur={() => { if ((newRoom ?? '').trim() === '') setNewRoom(undefined) }}
          />
        )}
        {roomError !== undefined && <div className={css.sendError} role="alert">{roomError}</div>}
        {state.rooms.map(r => (
          <button
            key={r.id}
            type="button"
            className={r.id === state.roomId ? `${css.room} ${css.roomActive}` : css.room}
            aria-current={r.id === state.roomId}
            onClick={() => { stickRef.current = true; setDrawer(undefined); void selectRoom(r.id) }}
          >
            <span className={css.hash} aria-hidden>#</span>{r.name}
          </button>
        ))}
      </nav>
      <section className={css.chat}>
        <header className={css.chatHead}>
          <button type="button" className={css.mobileButton} aria-label={t('showRooms')} aria-expanded={drawer === 'rooms'} onClick={() => setDrawer(drawer === 'rooms' ? undefined : 'rooms')}>☰</button>
          <button type="button" className={css.panelToggle} title={t(roomsHidden ? 'expandRooms' : 'collapseRooms')} aria-label={t(roomsHidden ? 'expandRooms' : 'collapseRooms')} aria-expanded={!roomsHidden} onClick={() => { setRoomsHidden(!roomsHidden) }}>{roomsHidden ? '»' : '«'}</button>
          <span className={css.hash} aria-hidden>#</span><span className={css.roomName}>{room?.name}</span>
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
            : state.messages.map(m => <MessageRow key={m.id} message={m} member={byId.get(m.author)} t={t} onConfigure={() => { setModelsOpen(true) }} />)}
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
      <aside className={drawer === 'members' ? `${css.members} ${css.drawerOpen}` : css.members}>
        <button type="button" className={css.addMemberButton} onClick={() => { setDrawer(undefined); setDialog(null) }}>+ {t('addMember')}</button>
        {memberError !== undefined && <div className={css.sendError} role="alert">{memberError}</div>}
        <MemberGroup title={t('agents', { count: String(state.members.filter(m => m.kind !== 'human').length) })} members={state.members.filter(m => m.kind !== 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
        <MemberGroup title={t('humans', { count: String(state.members.filter(m => m.kind === 'human').length) })} members={state.members.filter(m => m.kind === 'human')} busy={busy} onPick={pickFromList} onEdit={setDialog} onRemove={confirmRemove} t={t} />
      </aside>
      {modelsOpen && <div className={css.dialogBackdrop} onClick={() => { setModelsOpen(false) }}>
        <section className={css.dialog} role="dialog" aria-modal="true" aria-label={t('configureModel')} onClick={event => { event.stopPropagation() }}>
          <button type="button" className={css.secondaryButton} onClick={() => { setModelsOpen(false) }}>{t('close')}</button>
          {renderSlot('settings.section', { close: () => { setModelsOpen(false) } }, { only: 'models' })}
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
