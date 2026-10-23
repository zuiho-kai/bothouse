import type { RefObject, UIEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, ChannelMessage } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { MessageRow, type RelayState } from './MessageRow.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface MessageListProps {
  logRef: RefObject<HTMLDivElement>
  messages: readonly ChannelMessage[]
  membersById: ReadonlyMap<string, ChannelMember>
  busyNames: readonly string[]
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  relayState: (messageId: number) => RelayState
  onContinue: (roomId: number, messageId: number) => void
  t: T
}

export function MessageList({ logRef, messages, membersById, busyNames, onScroll, relayState, onContinue, t }: MessageListProps) {
  return (
    <>
      <div
        ref={logRef}
        className={css.log}
        role="log"
        aria-live="polite"
        onScroll={onScroll}
      >
        {messages.length === 0
          ? <div className={css.empty}>{t('empty')}</div>
          : messages.map(m => (
              <MessageRow
                key={m.id}
                message={m}
                member={membersById.get(m.author)}
                relay={relayState(m.id)}
                onContinue={onContinue}
                t={t}
              />
            ))}
      </div>
      <div className={css.working} aria-live="polite">
        {busyNames.length > 0 ? t('workingList', { names: busyNames.join('、') }) : ''}
      </div>
    </>
  )
}
