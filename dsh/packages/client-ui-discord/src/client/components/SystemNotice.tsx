import type { ChannelMessage } from '../channel-source.ts'
import { Avatar } from './Avatar.tsx'
import css from '../ChannelsPage.module.css'

export interface SystemNoticeProps {
  message: ChannelMessage
}

export function SystemNotice({ message }: SystemNoticeProps) {
  return (
    <div className={`${css.message} ${css.system}`}>
      <Avatar id={message.author} name={message.name} />
      <div className={css.messageBody}>
        <div className={css.messageHead}>
          <span className={css.author}>{message.name}</span>
          <time className={css.time}>{new Date(message.created_at * 1000).toLocaleString()}</time>
        </div>
        <div className={css.text}>{message.text}</div>
      </div>
    </div>
  )
}
