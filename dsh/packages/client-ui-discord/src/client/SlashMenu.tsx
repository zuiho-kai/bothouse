/**
 * The `/` command menu above the composer (#1016); keys are handled by the composer.
 * #1017: a fixed-width popover at the `/`, each description right after its command, the bare
 * menu split into 控制 / 模型 / 查看; the highlight moves without animation.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { SlashCommand, SlashGroup } from './slash-commands.ts'
import css from './ChannelsPage.module.css'

const GROUP_TITLE = { control: 'slashGroupControl', model: 'slashGroupModel', view: 'slashGroupView' } as const satisfies Record<SlashGroup, string>

export function SlashMenu({ commands, selected, target, grouped, t, onPick, onHover }: {
  commands: readonly SlashCommand[]
  selected: number
  /** Name of the member a command goes to (the primary role); undefined when none is set. */
  target: string | undefined
  /** Show section titles (the bare `/` menu); a filtered list is ranked by match instead. */
  grouped: boolean
  t: TranslateNS<typeof NS>
  onPick: (command: SlashCommand) => void
  onHover: (index: number) => void
}) {
  return (
    <div className={`${css.mentionPopup} ${css.slashPopup}`} role="region" aria-label={t('slashTitle')}>
      <div className={css.mentionTitle}>{target === undefined ? t('slashTitleNoLead') : t('slashTitleLead', { name: target })}</div>
      <div role="listbox" id="channel-slash-list" aria-label={t('slashTitle')}>
        {commands.map((c, index) => [
          grouped && c.group !== commands[index - 1]?.group
            ? <div key={`group-${c.group}`} className={css.slashGroup} role="presentation">{t(GROUP_TITLE[c.group])}</div>
            : null,
          <div
            key={c.name}
            id={`channel-slash-${index}`}
            role="option"
            aria-selected={index === selected}
            className={index === selected ? `${css.slashItem} ${css.slashActive}` : css.slashItem}
            onMouseDown={(event) => { event.preventDefault() }}
            onMouseEnter={() => { onHover(index) }}
            onClick={() => { onPick(c) }}
          >
            <span className={css.slashName}>/{c.name}</span>
            <span className={css.slashMeta}>{t(c.hint)}</span>
          </div>,
        ])}
      </div>
      <div className={css.mentionHint}>{t('slashHint')}</div>
    </div>
  )
}
