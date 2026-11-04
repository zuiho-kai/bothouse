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
  // #1017: 这次允许 first and solid; 拒绝 secondary; 本会话自动允许 last as a quiet text button —
  // it only covers this bot's current session (bridge core/engine.go allow_all), so it says so.
  const order = { allow: 0, deny: 1, allow_all: 2 } as const
  const actions = [...card.actions].sort((a, b) => order[a.decision] - order[b.decision])
  return (
    <div className={css.permActions}>
      {actions.map(a => (
        <button
          key={a.decision}
          type="button"
          className={a.decision === 'allow' ? css.primaryButton : a.decision === 'deny' ? css.secondaryButton : css.permSessionButton}
          title={a.decision === 'allow_all' ? t('permAllowAllScope') : undefined}
          disabled={busy}
          onClick={() => { decide(a.decision) }}
        >
          {a.decision === 'allow' ? t('permAllowOnce') : a.decision === 'allow_all' ? t('permAllowSession') : a.label}
        </button>
      ))}
      {error !== undefined && <div className={css.sendError} role="alert">{error}</div>}
    </div>
  )
}
