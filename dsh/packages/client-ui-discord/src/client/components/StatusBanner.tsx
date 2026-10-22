import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelSnapshot } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface StatusBannerProps {
  phase: ChannelSnapshot['phase']
  error?: string | undefined
  t: T
}

export function StatusBanner({ phase, error, t }: StatusBannerProps) {
  const notice = phase === 'unavailable' ? t('unavailable')
    : phase === 'unauthorized' ? t('unauthorized')
      : phase === 'error' ? t('error', { message: error ?? '' })
        : t('loading')
  return <div className={css.notice} role="status">{notice}</div>
}
