/**
 * Add/edit dialog for one DSH channel member: name, model (grouped by provider
 * route, as the host lists them) and persona. Submission goes through the
 * injected action; the host's refusal (name taken, model unavailable) is shown
 * inline and the form keeps its values.
 */
import { useEffect, useState, type FormEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, MemberInput, ModelRoute } from './channel-source.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

/** Which member the dialog edits; absent member means "add". */
export interface MemberDialogProps {
  readonly member: ChannelMember | undefined
  readonly listModels: () => Promise<readonly ModelRoute[]>
  readonly onSubmit: (input: MemberInput) => Promise<void>
  readonly onClose: () => void
  readonly t: TranslateNS<typeof NS>
}

const SEP = '\u0000'

/**
 * Render the member dialog.
 * @param props - target member, actions, and copy.
 * @returns a modal form.
 */
export function MemberDialog({ member, listModels, onSubmit, onClose, t }: MemberDialogProps) {
  const [name, setName] = useState(member?.name ?? '')
  const [persona, setPersona] = useState(member?.persona ?? '')
  const [modelKey, setModelKey] = useState(member?.model ? member.model.provider + SEP + member.model.model : '')
  const [routes, setRoutes] = useState<readonly ModelRoute[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // One read of the host's model catalog per dialog opening.
  useEffect(() => {
    let live = true
    listModels().then((list) => { if (live) setRoutes(list) }).catch((reason: unknown) => {
      if (live) { setRoutes([]); setError(reason instanceof Error ? reason.message : String(reason)) }
    })
    return () => { live = false }
  }, [listModels])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (busy) return
    const [provider, model] = modelKey === '' ? [] : modelKey.split(SEP)
    setBusy(true)
    setError(undefined)
    onSubmit({
      name: name.trim(),
      persona,
      model: provider !== undefined && model !== undefined ? { provider, model } : null,
    }).then(onClose).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }

  const current = member?.model ? member.model.provider + SEP + member.model.model : undefined
  const listed = routes?.some(r => r.models.some(m => r.provider + SEP + m.id === current)) ?? false

  return (
    <div className={css.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={member === undefined ? t('memberDialogAdd') : t('memberDialogEdit', { name: member.name })}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 className={css.dialogTitle}>{member === undefined ? t('memberDialogAdd') : t('memberDialogEdit', { name: member.name })}</h2>
        <label className={css.field}>
          <span>{t('memberName')}</span>
          <input className={css.fieldInput} value={name} maxLength={32} autoFocus onChange={(event) => { setName(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span>{t('memberModel')}</span>
          <select className={css.fieldInput} value={modelKey} disabled={routes === undefined} onChange={(event) => { setModelKey(event.target.value) }}>
            <option value="">{routes === undefined ? t('memberModelLoading') : t('memberModelDefault')}</option>
            {current !== undefined && !listed && member?.model && (
              <option value={current}>{`${member.model.provider}/${member.model.model}`}</option>
            )}
            {routes?.map(route => (
              <optgroup key={route.provider} label={route.error === undefined ? route.name : t('memberModelRouteError', { route: route.name, error: route.error })}>
                {route.models.map(m => (
                  <option key={m.id} value={route.provider + SEP + m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span>{t('memberPersona')}</span>
          <textarea className={css.fieldInput} rows={4} value={persona} maxLength={4000} onChange={(event) => { setPersona(event.target.value) }} />
        </label>
        {error !== undefined && <div className={css.sendError} role="alert">{error}</div>}
        <div className={css.dialogActions}>
          <button type="button" className={css.secondaryButton} onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className={css.primaryButton} disabled={busy || name.trim() === ''}>{t('save')}</button>
        </div>
      </form>
    </div>
  )
}
