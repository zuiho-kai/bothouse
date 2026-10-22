import type { KeyboardEvent, RefObject, UIEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, ChannelMessage, ChannelRoom } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { RoomHeader } from './RoomHeader.tsx'
import { MessageList } from './MessageList.tsx'
import { Composer } from './Composer.tsx'
import type { RelayState } from './MessageRow.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface RoomViewProps {
  room: ChannelRoom | undefined
  roomId: number | undefined
  drawer: 'rooms' | 'members' | undefined
  logRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLTextAreaElement | null>
  messages: readonly ChannelMessage[]
  membersById: ReadonlyMap<string, ChannelMember>
  busyNames: readonly string[]
  draft: string
  sendError: string | undefined
  sending: boolean
  popupOpen: boolean
  mentionQuery: string
  candidates: readonly ChannelMember[]
  selected: number
  busy: ReadonlySet<string>
  onToggleRooms: () => void
  onToggleMembers: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  onDraftChange: (value: string, caret: number) => void
  onSelectCaret: (caret: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onOpenPicker: () => void
  onSelectCandidate: (member: ChannelMember) => void
  onHighlightCandidate: (index: number) => void
  stopping: boolean
  stopNotice: string | undefined
  onStop: () => void
  onCloseNotice: () => void
  relayState: (messageId: number) => RelayState
  onContinue: (roomId: number, messageId: number) => void
  t: T
}

export function RoomView({
  room,
  roomId,
  drawer,
  logRef,
  inputRef,
  messages,
  membersById,
  busyNames,
  draft,
  sendError,
  sending,
  popupOpen,
  mentionQuery,
  candidates,
  selected,
  busy,
  onToggleRooms,
  onToggleMembers,
  onScroll,
  onDraftChange,
  onSelectCaret,
  onKeyDown,
  onOpenPicker,
  onSelectCandidate,
  onHighlightCandidate,
  stopping,
  stopNotice,
  onStop,
  onCloseNotice,
  relayState,
  onContinue,
  t,
}: RoomViewProps) {
  return (
    <section className={css.chat}>
      <RoomHeader
        roomName={room?.name}
        drawer={drawer}
        onToggleRooms={onToggleRooms}
        onToggleMembers={onToggleMembers}
        onStop={roomId === undefined ? undefined : onStop}
        stopping={stopping}
        t={t}
      />
      {stopNotice !== undefined && (
        <div className={css.roomNotice} role="status" aria-live="polite">
          <span className={css.roomNoticeText}>{stopNotice}</span>
          <button
            type="button"
            className={css.noticeClose}
            title={t('closeNotice')}
            aria-label={t('closeNotice')}
            onClick={onCloseNotice}
          >
            ×
          </button>
        </div>
      )}
      <MessageList
        logRef={logRef}
        messages={messages}
        membersById={membersById}
        busyNames={busyNames}
        onScroll={onScroll}
        relayState={relayState}
        onContinue={onContinue}
        t={t}
      />
      <Composer
        inputRef={inputRef}
        draft={draft}
        sendError={sendError}
        disabled={roomId === undefined || sending}
        placeholder={t('placeholder', { room: room?.name ?? '' })}
        popupOpen={popupOpen}
        mentionQuery={mentionQuery}
        candidates={candidates}
        selected={selected}
        busy={busy}
        onDraftChange={onDraftChange}
        onSelectCaret={onSelectCaret}
        onKeyDown={onKeyDown}
        onOpenPicker={onOpenPicker}
        onSelectCandidate={onSelectCandidate}
        onHighlightCandidate={onHighlightCandidate}
        t={t}
      />
    </section>
  )
}
