import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

export interface RelayLimitCardProps {
  text: string
  continuing: boolean
  resumed: boolean
  error: string | undefined
  onContinue: () => void
  t: T
}

/** System card posted when the relay limit stopped a hand-off; its button resumes the relay once. */
export function RelayLimitCard({ text, continuing, resumed, error, onContinue, t }: RelayLimitCardProps) {
  return (
    <div className={`${css.card} ${css.relayCard}`} data-type="relay_limit">
      <div className={css.relayCardBody}>
        <div className={css.relayCardText}>{text}</div>
        <button
          type="button"
          className={css.continueButton}
          title={t('continueRoomTitle')}
          aria-label={t('continueRoom')}
          disabled={continuing || resumed}
          onClick={onContinue}
        >
          {continuing ? t('continuingRoom') : resumed ? t('continueResumed') : t('continueRoom')}
        </button>
      </div>
      {error !== undefined && <div className={css.cardError} role="alert">{error}</div>}
    </div>
  )
}
