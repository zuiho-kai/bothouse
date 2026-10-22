import type { KeyboardEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelRoom } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface RoomListProps {
  rooms: readonly ChannelRoom[]
  activeRoomId: number | undefined
  isOpenOnMobile: boolean
  newRoom: string | undefined
  roomError: string | undefined
  onSelectRoom: (roomId: number) => void
  onStartNewRoom: () => void
  onCancelNewRoom: () => void
  onNewRoomChange: (value: string) => void
  onSubmitRoom: () => void
  t: T
}

export function RoomList({
  rooms,
  activeRoomId,
  isOpenOnMobile,
  newRoom,
  roomError,
  onSelectRoom,
  onStartNewRoom,
  onCancelNewRoom,
  onNewRoomChange,
  onSubmitRoom,
  t,
}: RoomListProps) {
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmitRoom()
    }
    if (event.key === 'Escape') {
      onCancelNewRoom()
    }
  }

  return (
    <nav
      className={isOpenOnMobile ? `${css.rooms} ${css.drawerOpen}` : css.rooms}
      aria-label={t('rooms')}
    >
      <div className={css.groupHead}>
        <h3 className={css.groupTitle}>{t('rooms')}</h3>
        <button
          type="button"
          className={css.iconButton}
          title={t('newRoom')}
          aria-label={t('newRoom')}
          onClick={onStartNewRoom}
        >
          +
        </button>
      </div>
      {newRoom !== undefined && (
        <input
          className={css.roomInput}
          autoFocus
          value={newRoom}
          maxLength={32}
          placeholder={t('newRoomPlaceholder')}
          aria-label={t('newRoom')}
          onChange={(event) => { onNewRoomChange(event.target.value) }}
          onKeyDown={onInputKeyDown}
          onBlur={() => { if ((newRoom ?? '').trim() === '') onCancelNewRoom() }}
        />
      )}
      {roomError !== undefined && <div className={css.sendError} role="alert">{roomError}</div>}
      {rooms.map(r => (
        <button
          key={r.id}
          type="button"
          className={r.id === activeRoomId ? `${css.room} ${css.roomActive}` : css.room}
          aria-current={r.id === activeRoomId}
          onClick={() => { onSelectRoom(r.id) }}
        >
          <span className={css.hash} aria-hidden>#</span>{r.name}
        </button>
      ))}
    </nav>
  )
}
