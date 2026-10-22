/**
 * Channels main panel: room list, message stream with composer, and member
 * list, in a Discord-style three-column layout. All data arrives through the
 * injected `useChannels` hook; posting goes through the injected actions.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type UIEvent } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ChannelActions, ChannelMember, ChannelSnapshot } from './channel-source.ts'
import { activeMention, applyMention, insertMention, rankMembers } from './mention-complete.ts'
import { MemberDialog } from './MemberDialog.tsx'
import {
  MemberPanel,
  RoomList,
  RoomView,
  StatusBanner,
} from './components/index.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

/** Injected share: the channel snapshot source and its actions. */
export interface ChannelsInjected extends ChannelActions {
  readonly hooks: { readonly channels: HostObservable<ChannelSnapshot> }
}

/** Full props of the channels main panel. */
export type ChannelsPageProps = PropsRuntime<'main'> & InjectFace<ChannelsInjected> & PropsLocale<typeof NS>

type T = TranslateNS<typeof NS>

/**
 * Render the channels panel.
 * @param props - framework, injected, and locale shares.
 * @returns the three-column channel view.
 */
export function ChannelsPage({ useChannels, selectRoom, send, createRoom, listModels, addMember, updateMember, removeMember, t }: ChannelsPageProps) {
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
  const [newRoom, setNewRoom] = useState<string | undefined>(undefined)
  const [roomError, setRoomError] = useState<string | undefined>(undefined)
  const [memberError, setMemberError] = useState<string | undefined>(undefined)
  const [drawer, setDrawer] = useState<'rooms' | 'members' | undefined>(undefined)
  const roomsRef = useRef<HTMLElement>(null)
  const membersRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (drawer === 'rooms') {
      roomsRef.current?.focus()
    } else if (drawer === 'members') {
      membersRef.current?.focus()
    }
  }, [drawer])

  useEffect(() => {
    if (drawer === undefined) return
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        setDrawer(undefined)
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => { window.removeEventListener('keydown', onEscape) }
  }, [drawer])

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
    return (
      <div className={css.page}>
        <StatusBanner phase={state.phase} error={state.error} t={t} />
      </div>
    )
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
    createRoom(name).then(() => { setNewRoom(undefined); setDrawer(undefined) }).catch((error: unknown) => {
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

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
  }

  return (
    <div className={css.page}>
      <RoomList
        rooms={state.rooms}
        activeRoomId={state.roomId}
        isOpenOnMobile={drawer === 'rooms'}
        drawerRef={roomsRef}
        newRoom={newRoom}
        roomError={roomError}
        onSelectRoom={(roomId) => {
          stickRef.current = true
          setDrawer(undefined)
          void selectRoom(roomId)
        }}
        onStartNewRoom={() => { setNewRoom(''); setRoomError(undefined) }}
        onCancelNewRoom={() => { setNewRoom(undefined); setRoomError(undefined) }}
        onNewRoomChange={setNewRoom}
        onSubmitRoom={submitRoom}
        onCloseDrawer={() => { setDrawer(undefined) }}
        t={t}
      />
      <RoomView
        room={room}
        roomId={state.roomId}
        drawer={drawer}
        logRef={logRef}
        inputRef={inputRef}
        messages={state.messages}
        membersById={byId}
        busyNames={busyNames}
        draft={draft}
        sendError={sendError}
        sending={state.roomId !== undefined && sending[state.roomId] === true}
        popupOpen={popupOpen}
        mentionQuery={mention?.query ?? ''}
        candidates={candidates}
        selected={selected}
        busy={busy}
        onToggleRooms={() => { setDrawer(d => d === 'rooms' ? undefined : 'rooms') }}
        onToggleMembers={() => { setDrawer(d => d === 'members' ? undefined : 'members') }}
        onScroll={onScroll}
        onDraftChange={(value, nextCaret) => {
          const roomId = state.roomId
          if (roomId !== undefined) setDrafts(previous => ({ ...previous, [roomId]: value }))
          setCaret(nextCaret)
          setHighlight(0)
        }}
        onSelectCaret={setCaret}
        onKeyDown={onKeyDown}
        onOpenPicker={openPicker}
        onSelectCandidate={choose}
        onHighlightCandidate={setHighlight}
        t={t}
      />
      <MemberPanel
        members={state.members}
        busy={busy}
        isOpenOnMobile={drawer === 'members'}
        drawerRef={membersRef}
        memberError={memberError}
        onAddMember={() => { setDialog(null) }}
        onPickMember={pickFromList}
        onEditMember={setDialog}
        onRemoveMember={confirmRemove}
        onCloseDrawer={() => { setDrawer(undefined) }}
        t={t}
      />
      {drawer !== undefined && (
        <div
          className={css.mobileBackdrop}
          role="presentation"
          aria-hidden="true"
          onClick={() => { setDrawer(undefined) }}
        />
      )}
      {dialog !== undefined && (
        <MemberDialog
          member={dialog ?? undefined}
          listModels={listModels}
          onSubmit={input => (dialog === null ? addMember(input) : updateMember(dialog.id, input))}
          onClose={() => { setDialog(undefined) }}
          t={t}
        />
      )}
    </div>
  )
}
