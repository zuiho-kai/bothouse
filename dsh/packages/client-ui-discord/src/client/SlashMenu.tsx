/** The `/` command menu above the composer (#1016); keys are handled by the composer. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { SlashCommand } from './slash-commands.ts'
import css from './ChannelsPage.module.css'

export function SlashMenu({ commands, selected, target, t, onPick, onHover }: {
  commands: readonly SlashCommand[]
  selected: number
  /** Name of the member a command goes to (the primary role); undefined when none is set. */
  target: string | undefined
  t: TranslateNS<typeof NS>
  onPick: (command: SlashCommand) => void
  onHover: (index: number) => void
}) {
  return (
    <div className={`${css.mentionPopup} ${css.slashPopup}`} role="region" aria-label={t('slashTitle')}>
      <div className={css.mentionTitle}>{target === undefined ? t('slashTitleNoLead') : t('slashTitleLead', { name: target })}</div>
      <div role="listbox" id="channel-slash-list" aria-label={t('slashTitle')}>
        {commands.map((c, index) => (
          <div
            key={c.name}
            id={`channel-slash-${index}`}
            role="option"
            aria-selected={index === selected}
            className={index === selected ? `${css.mentionItem} ${css.mentionActive}` : css.mentionItem}
            onMouseDown={(event) => { event.preventDefault() }}
            onMouseEnter={() => { onHover(index) }}
            onClick={() => { onPick(c) }}
          >
            <span className={css.slashName}>/{c.name}</span>
            <span className={css.mentionMeta}>{t(c.hint)}</span>
          </div>
        ))}
      </div>
      <div className={css.mentionHint}>{t('slashHint')}</div>
    </div>
  )
}
