/**
 * Buttons for a cloud-web bot's permission prompt (#120). The card JSON is
 * written by dsh/collab/cloudweb.mjs; the decision goes to
 * POST collab/api/messages/{id}/permission, and the updated card arrives back
 * as a `message` event, so the state shown here always comes from the server.
 */
import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PermissionDecision } from './channel-source.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

/** Permission card metadata as stored in `ChannelMessage.card`. */
export interface PermissionCardData {
  readonly kind: 'permission'
  readonly state: 'pending' | 'allowed' | 'denied' | 'allowed_all' | 'expired'
  readonly actions: readonly { readonly decision: PermissionDecision; readonly label: string }[]
  readonly decided_by?: 'button' | 'text'
}

const STATE_TEXT = { allowed: 'permAllowed', denied: 'permDenied', allowed_all: 'permAllowedAll', expired: 'permExpired' } as const

export function PermissionCard({ messageId, card, t, onDecide }: {
  messageId: number
  card: PermissionCardData
  t: T
  onDecide: (messageId: number, decision: PermissionDecision) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  if (card.state !== 'pending') {
    return (
      <div className={css.permStatus} role="status">
        {t(STATE_TEXT[card.state])}
        {card.decided_by === 'text' && ` ${t('permByText')}`}
      </div>
    )
  }
  const decide = (decision: PermissionDecision): void => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    onDecide(messageId, decision)
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { setBusy(false) })
  }
  return (
    <div className={css.permActions}>
      {card.actions.map(a => (
        <button
          key={a.decision}
          type="button"
          className={a.decision === 'deny' ? css.secondaryButton : css.primaryButton}
          disabled={busy}
          onClick={() => { decide(a.decision) }}
        >
          {a.label}
        </button>
      ))}
      {card.actions.some(a => a.decision === 'allow_all') && <div className={css.permScope}>{t('permAllowAllScope')}</div>}
      {error !== undefined && <div className={css.sendError} role="alert">{error}</div>}
    </div>
  )
}
