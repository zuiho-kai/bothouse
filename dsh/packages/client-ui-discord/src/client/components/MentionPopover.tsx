import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { Avatar } from './Avatar.tsx'
import { KindTag } from './KindTag.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface MentionPopoverProps {
  query: string
  candidates: readonly ChannelMember[]
  selected: number
  busy: ReadonlySet<string>
  onSelect: (member: ChannelMember) => void
  onHighlight: (index: number) => void
  t: T
}

export function MentionPopover({ query, candidates, selected, busy, onSelect, onHighlight, t }: MentionPopoverProps) {
  return (
    <div className={css.mentionPopup}>
      <div className={css.mentionTitle}>
        {query === '' ? t('mentionTitle') : t('mentionTitleQuery', { query })}
      </div>
      <div role="listbox" id="channel-mention-list" aria-label={t('mentionTitle')}>
        {candidates.map((m, index) => (
          <div
            key={m.id}
            id={`channel-mention-${m.id}`}
            role="option"
            aria-selected={index === selected}
            className={index === selected ? `${css.mentionItem} ${css.mentionActive}` : css.mentionItem}
            onMouseDown={(event) => { event.preventDefault() }}
            onMouseEnter={() => { onHighlight(index) }}
            onClick={() => { onSelect(m) }}
          >
            <span className={css.memberAvatar}>
              <Avatar id={m.id} name={m.name} small />
              {m.online && <span className={css.presence} />}
            </span>
            <span className={css.mentionName}>{m.name}</span>
            <KindTag kind={m.kind} t={t} />
            <span className={css.mentionMeta}>
              {busy.has(m.id) ? t('working') : m.online ? `@${m.id}` : t('offline')}
            </span>
          </div>
        ))}
      </div>
      <div className={css.mentionHint}>{t('mentionHint')}</div>
    </div>
  )
}
