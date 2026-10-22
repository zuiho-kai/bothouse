import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, ChannelMessage } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { Avatar } from './Avatar.tsx'
import { KindTag } from './KindTag.tsx'
import { ProgressCard } from './ProgressCard.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface MessageRowProps {
  message: ChannelMessage
  member: ChannelMember | undefined
  t: T
}

export function MessageRow({ message, member, t }: MessageRowProps) {
  let card: { title?: string; state?: string } | undefined
  if (message.card !== null) {
    try { card = JSON.parse(message.card) as { title?: string; state?: string } } catch (error) { void error /* unreadable card metadata: render the text alone */ }
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
          : <ProgressCard title={card.title} state={card.state} text={message.text} />}
      </div>
    </div>
  )
}
