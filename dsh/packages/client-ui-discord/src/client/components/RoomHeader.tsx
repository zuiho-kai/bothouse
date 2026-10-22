import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface RoomHeaderProps {
  roomName: string | undefined
  drawer: 'rooms' | 'members' | undefined
  onToggleRooms: () => void
  onToggleMembers: () => void
  t: T
}

export function RoomHeader({ roomName, drawer, onToggleRooms, onToggleMembers, t }: RoomHeaderProps) {
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
