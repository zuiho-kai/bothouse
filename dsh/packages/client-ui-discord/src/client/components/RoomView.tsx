import type { KeyboardEvent, RefObject, UIEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, ChannelMessage, ChannelRoom } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { RoomHeader } from './RoomHeader.tsx'
import { MessageList } from './MessageList.tsx'
import { Composer } from './Composer.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface RoomViewProps {
  room: ChannelRoom | undefined
  roomId: number | undefined
  drawer: 'rooms' | 'members' | undefined
  logRef: RefObject<HTMLDivElement>
  inputRef: RefObject<HTMLTextAreaElement>
  messages: readonly ChannelMessage[]
  reconnecting: boolean
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
  t: T
}

export function RoomView({
  room,
  roomId,
  drawer,
  logRef,
  inputRef,
  messages,
  reconnecting,
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
  t,
}: RoomViewProps) {
  return (
    <section className={css.chat}>
      <RoomHeader
        roomName={room?.name}
        drawer={drawer}
        onToggleRooms={onToggleRooms}
        onToggleMembers={onToggleMembers}
        t={t}
      />
      {reconnecting && <div className={css.reconnecting} role="status">{t('reconnecting')}</div>}
      <MessageList
        logRef={logRef}
        messages={messages}
        membersById={membersById}
        busyNames={busyNames}
        onScroll={onScroll}
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
