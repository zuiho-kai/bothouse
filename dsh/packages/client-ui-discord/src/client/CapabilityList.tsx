/** On-demand help for existing capabilities; selecting help never executes an action. */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

const CAPABILITIES = [
  ['capabilityTaskBoard', 'capabilityTaskBoardHelp'],
  ['capabilityLater', 'capabilityLaterHelp'],
  ['capabilityReminder', 'capabilityReminderHelp'],
  ['capabilityWorkspace', 'capabilityWorkspaceHelp'],
  ['capabilityLead', 'capabilityLeadHelp'],
  ['capabilityDm', 'capabilityDmHelp'],
] as const

/** Show the capability names and, after selection, the corresponding usage. */
export function CapabilityList({ t, onClose }: { t: TranslateNS<typeof NS>; onClose: () => void }) {
  const [selected, setSelected] = useState<(typeof CAPABILITIES)[number] | undefined>()
  return (
    <section className={css.capabilityMenu} aria-label={t('capabilities')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className={css.groupHead}>
        <strong>{t('capabilities')}</strong>
        <button type="button" className={css.iconButton} aria-label={t('close')} onClick={onClose}>×</button>
      </div>
      {CAPABILITIES.map(item => <button key={item[0]} type="button" className={css.capabilityItem} aria-pressed={selected === item} onClick={() => { setSelected(item) }}>{t(item[0])}</button>)}
      {selected !== undefined && <p className={css.capabilityHelp} role="status">{t(selected[1])}</p>}
    </section>
  )
}
