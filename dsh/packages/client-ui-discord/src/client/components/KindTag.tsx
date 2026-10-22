import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface KindTagProps {
  kind: ChannelMember['kind'] | undefined
  t: T
}

export function KindTag({ kind, t }: KindTagProps) {
  if (kind === 'dsh') return <span className={css.tag}>{t('kindDsh')}</span>
  if (kind === 'bot') return <span className={css.tag}>{t('kindBot')}</span>
  return null
}
