import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface RoomHeaderProps {
  roomName: string | undefined
  drawer: 'rooms' | 'members' | undefined
  onToggleRooms: () => void
  onToggleMembers: () => void
  /** Shown only when a room is open. */
  onStop: (() => void) | undefined
  stopping: boolean
  t: T
}

export function RoomHeader({ roomName, drawer, onToggleRooms, onToggleMembers, onStop, stopping, t }: RoomHeaderProps) {
  return (
    <header className={css.chatHead}>
      <button
        type="button"
        className={css.mobileNavButton}
        aria-label={t('toggleRooms')}
        title={t('toggleRooms')}
        aria-expanded={drawer === 'rooms'}
        onClick={onToggleRooms}
      >
        ☰
      </button>
      <span className={css.chatTitle}><span className={css.hash} aria-hidden>#</span>{roomName}</span>
      {onStop !== undefined && (
        <div className={css.chatHeadActions}>
          <button
            type="button"
            className={css.stopButton}
            title={t('stopRoomTitle')}
            aria-label={t('stopRoom')}
            disabled={stopping}
            onClick={onStop}
          >
            <span className={css.stopIcon} aria-hidden />
            <span>{stopping ? t('stoppingRoom') : t('stopRoom')}</span>
          </button>
        </div>
      )}
      <button
        type="button"
        className={css.mobileNavButton}
        aria-label={t('toggleMembers')}
        title={t('toggleMembers')}
        aria-expanded={drawer === 'members'}
        onClick={onToggleMembers}
      >
        👥
      </button>
    </header>
  )
}
