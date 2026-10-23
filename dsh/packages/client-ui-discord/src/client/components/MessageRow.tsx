import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, ChannelMessage } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { Avatar } from './Avatar.tsx'
import { KindTag } from './KindTag.tsx'
import { ProgressCard } from './ProgressCard.tsx'
import { RelayLimitCard } from './RelayLimitCard.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

/** Per-message state of the relay-limit card's continue button. */
export interface RelayState {
  continuing: boolean
  resumed: boolean
  error: string | undefined
}

export interface MessageRowProps {
  message: ChannelMessage
  member: ChannelMember | undefined
  relay: RelayState
  onContinue: (roomId: number, messageId: number) => void
  t: T
}

export function MessageRow({ message, member, relay, onContinue, t }: MessageRowProps) {
  const isSystem = message.author_kind === 'system' || message.name === 'system'
  const authorName = isSystem ? t('systemAuthor') : message.name
  let card: { title?: string; state?: string; type?: string; room_id?: number } | undefined
  if (message.card !== null) {
    try { card = JSON.parse(message.card) as { title?: string; state?: string; type?: string; room_id?: number } } catch (error) { void error /* unreadable card metadata: render the text alone */ }
  }
  let body
  if (card === undefined) {
    body = message.text ? <div className={css.text}>{message.text}</div> : null
  } else if (card.type === 'relay_limit') {
    const roomId = card.room_id ?? message.room_id
    body = (
      <RelayLimitCard
        text={message.text}
        continuing={relay.continuing}
        resumed={relay.resumed}
        error={relay.error}
        onContinue={() => { onContinue(roomId, message.id) }}
        t={t}
      />
    )
  } else {
    const hasTitle = Boolean(card.title && card.title.trim())
    const hasText = Boolean(message.text && message.text.trim())
    body = hasTitle || hasText
      ? <ProgressCard title={card.title} state={card.state} text={message.text} />
      : null
  }
  return (
    <div className={message.author_kind === 'system' ? `${css.message} ${css.system}` : css.message}>
      <Avatar id={message.author} name={authorName} />
      <div className={css.messageBody}>
        <div className={css.messageHead}>
          <span className={css.author}>{authorName}</span>
          <KindTag kind={member?.kind} t={t} />
          <time className={css.time}>{new Date(message.created_at * 1000).toLocaleString()}</time>
        </div>
        {body}
      </div>
    </div>
  )
}
