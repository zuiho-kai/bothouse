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

export function SlashMenu({ commands, selected, target, leadName, dmName, disabled = () => false, grouped, t, onPick, onHover }: {
  commands: readonly SlashCommand[]
  selected: number
  /** Name of the member a command goes to (the primary role); undefined when none is set. */
  target: string | undefined
  /** #268: a primary role is set but takes no command — say so instead of "no primary role chosen". */
  leadName?: string
  /** 体检 #5: set in a private chat — the agent there, named in the title when it takes no command. */
  dmName?: string
  /** 体检 #5: commands no one can take here are greyed out and do nothing when picked. */
  disabled?: (command: SlashCommand) => boolean
  /** Show section titles (the bare `/` menu); a filtered list is ranked by match instead. */
  grouped: boolean
  t: TranslateNS<typeof NS>
  onPick: (command: SlashCommand) => void
  onHover: (index: number) => void
}) {
  // 体检 #5 names the agent of a private chat; #268 names a primary role that takes no command.
  const noCmd = dmName ?? leadName
  return (
    <div className={`${css.mentionPopup} ${css.slashPopup}`} role="region" aria-label={t('slashTitle')}>
      <div className={css.mentionTitle}>{target !== undefined ? t('slashTitleLead', { name: target }) : noCmd !== undefined ? t('slashTitleDmNoCmd', { name: noCmd }) : t('slashTitleNoLead')}</div>
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
            aria-disabled={disabled(c) || undefined}
            title={disabled(c) ? t('slashDisabledHint') : undefined}
            className={[css.slashItem, index === selected ? css.slashActive : '', disabled(c) ? css.slashDisabled : ''].filter(Boolean).join(' ')}
            onMouseDown={(event) => { event.preventDefault() }}
            onMouseEnter={() => { onHover(index) }}
            onClick={() => { if (!disabled(c)) onPick(c) }}
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
