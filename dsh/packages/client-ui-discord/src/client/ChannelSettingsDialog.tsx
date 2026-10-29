import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelActions, ChannelMember, ChannelRoom, DispatchMode } from './channel-source.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

type Tab = 'basic' | 'dispatch' | 'workspace'
const tabs = ['basic', 'dispatch', 'workspace'] as const
const tabLabels = { basic: 'settingsBasic', dispatch: 'settingsDispatch', workspace: 'settingsWorkspace' } as const

type Props = Pick<ChannelActions, 'renameRoom' | 'setDispatchMode' | 'setLead' | 'setWorkspacePath' | 'renewRoom'> & {
  room: ChannelRoom
  members: readonly ChannelMember[]
  effectiveLead: string
  t: TranslateNS<typeof NS>
  onClose: () => void
}

/** Drafts and save outcomes live for the whole dialog, independently of the selected tab. */
export function ChannelSettingsDialog({ room, members, effectiveLead, renameRoom, setDispatchMode, setLead, setWorkspacePath, renewRoom, t, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('basic')
  const [name, setName] = useState(room.name)
  const [mode, setMode] = useState<DispatchMode>(room.dispatch_mode ?? 'mixed')
  const [lead, setLeadDraft] = useState(effectiveLead)
  const [directory, setDirectory] = useState(room.workspace_path ?? '')
  const [saved, setSaved] = useState({ name: room.name, mode: room.dispatch_mode ?? 'mixed', lead: effectiveLead, directory: room.workspace_path ?? '' })
  const [saving, setSaving] = useState<Partial<Record<Tab, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<Tab, string>>>({})
  const [success, setSuccess] = useState<Partial<Record<Tab, boolean>>>({})
  const [renewPending, setRenewPending] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => { dialogRef.current?.focus() }, [])

  const dirty = {
    basic: room.kind !== 'workspace' && name !== saved.name,
    dispatch: mode !== saved.mode || lead !== saved.lead,
    workspace: directory !== saved.directory,
  }
  const close = (): void => {
    if (Object.values(saving).some(Boolean) || renewing) return
    if (Object.values(dirty).some(Boolean) && !window.confirm(t('settingsDiscardConfirm'))) return
    onClose()
  }
  const clearFeedback = (target: Tab): void => {
    setErrors(previous => ({ ...previous, [target]: undefined }))
    setSuccess(previous => ({ ...previous, [target]: false }))
  }
  const save = async (target: Tab): Promise<void> => {
    if (saving[target] || !dirty[target]) return
    if (target === 'basic' && (!name || name.length > 32 || /\s/.test(name))) return
    if (target === 'workspace' && (!directory || renewing || renewPending)) return
    setSaving(previous => ({ ...previous, [target]: true }))
    clearFeedback(target)
    try {
      if (target === 'basic') {
        await renameRoom(room.id, name)
        setSaved(previous => ({ ...previous, name }))
      } else if (target === 'dispatch') {
        // Separate existing endpoints: retain each successful field if the next one fails.
        if (mode !== saved.mode) {
          await setDispatchMode(room.id, mode)
          setSaved(previous => ({ ...previous, mode }))
        }
        if (lead !== saved.lead) {
          await setLead(lead, room.id)
          setSaved(previous => ({ ...previous, lead }))
        }
      } else {
        await setWorkspacePath(room.id, directory)
        setSaved(previous => ({ ...previous, directory }))
        setRenewPending(true)
      }
      setSuccess(previous => ({ ...previous, [target]: true }))
    } catch (error) {
      setErrors(previous => ({ ...previous, [target]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setSaving(previous => ({ ...previous, [target]: false }))
    }
  }

  return <div className={css.dialogBackdrop} onClick={close}>
    <section ref={dialogRef} tabIndex={-1} className={css.dialog} role="dialog" aria-modal="true" aria-label={t('channelSettings')} onClick={event => { event.stopPropagation() }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(control => control.tabIndex >= 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (!controls.includes(document.activeElement as HTMLElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }}>
      <h2 className={css.dialogTitle}>{t('channelSettings')}</h2>
      <div className={css.settingsTabs} role="tablist" aria-label={t('channelSettings')}>
        {tabs.map((value, index) => <button key={value} id={`settings-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`settings-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={css.settingsTab} onClick={() => { setTab(value) }} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : tabs[(index + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length]
          setTab(next)
          document.getElementById(`settings-tab-${next}`)?.focus()
        }}>{t(tabLabels[value])}</button>)}
      </div>
      <div id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        <form onSubmit={event => { event.preventDefault(); void save(tab) }}>
          {tab === 'basic' && <>
            <label className={css.field}>{t('channelName')}
              <input className={css.fieldInput} aria-label={t('channelName')} value={name} disabled={saving.basic || room.kind === 'workspace'} onChange={event => { setName(event.target.value); clearFeedback('basic') }} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault() }} />
            </label>
            <p>{t(room.kind === 'workspace' ? 'workspaceNameFixed' : 'channelNameHint')}</p>
          </>}
          {tab === 'dispatch' && <>
            <fieldset disabled={saving.dispatch}>
              <legend>{t('dispatchMode')}</legend>
              {(['solo', 'team', 'mixed'] as const).map(value => <label key={value} style={{ display: 'block' }}>
                <input type="radio" name="settings-dispatch-mode" checked={mode === value} onChange={() => { setMode(value); clearFeedback('dispatch') }} />
                {t(value === 'solo' ? 'dispatchSolo' : value === 'team' ? 'dispatchTeam' : 'dispatchMixed')}
              </label>)}
            </fieldset>
            <label className={css.field}>{t('channelLead')}
              <select className={css.fieldInput} aria-label={t('channelLead')} value={lead} disabled={saving.dispatch} onChange={event => { setLeadDraft(event.target.value); clearFeedback('dispatch') }}>
                <option value="" disabled>{t('leadNone')}</option>
                {members.filter(member => member.kind !== 'human').map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
          </>}
          {tab === 'workspace' && <>
            <label className={css.field}>{t('workingDirectory')}
              <input className={css.fieldInput} aria-label={t('workingDirectory')} value={directory} disabled={saving.workspace || renewing || renewPending} onChange={event => { setDirectory(event.target.value); clearFeedback('workspace') }} />
            </label>
            <p>{t('workingDirectoryHint')}</p>
          </>}
          <button type="submit" className={css.primaryButton} disabled={saving[tab] || !dirty[tab] || (tab === 'basic' && (!name || name.length > 32 || /\s/.test(name))) || (tab === 'workspace' && (!directory || renewing || renewPending))}>{t('messageSave')}</button>
        </form>
        {success[tab] && <p role="status">{t('settingsSaved')}</p>}
        {tab === 'workspace' && renewPending && <section role="alertdialog" aria-label={t('renewConfirm')}>
          <p>{t('renewConfirm')}</p>
          <button type="button" className={css.primaryButton} disabled={renewing} onClick={() => {
            setRenewing(true); setErrors(previous => ({ ...previous, workspace: undefined }))
            renewRoom(room.id).then(() => { setRenewPending(false) }).catch((error: unknown) => {
              setErrors(previous => ({ ...previous, workspace: error instanceof Error ? error.message : String(error) }))
            }).finally(() => { setRenewing(false) })
          }}>{t('renewNow')}</button>
          <button type="button" className={css.secondaryButton} disabled={renewing} onClick={() => { setRenewPending(false) }}>{t('renewLater')}</button>
        </section>}
        {errors[tab] !== undefined && <p role="alert">{errors[tab]}</p>}
      </div>
      <button type="button" className={css.secondaryButton} disabled={Object.values(saving).some(Boolean) || renewing} onClick={close}>{t('close')}</button>
    </section>
  </div>
}
