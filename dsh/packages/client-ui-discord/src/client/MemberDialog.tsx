/**
 * Add/edit dialog for one channel member: name, persona, and either a DSH
 * model (grouped by provider route, as the host lists them) or, when adding, a
 * CLI agent installed on this machine (Claude Code, Codex, Gemini), plus one of the built-in
 * avatars or none (initial badge). Submission goes through the
 * injected action; the host's refusal (name taken, model unavailable) is shown
 * inline and the form keeps its values.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember, LocalCli, MemberInput, MemberPersona, ModelRoute, PermissionPreset } from './channel-source.ts'
import type { NS } from './locales.ts'
import { Avatar } from './Avatar.tsx'
import { renamePersonaIdentity } from './persona.ts'
import { AVATARS } from './avatars.ts'
import { loadAvatar, uploadAvatar } from './avatar-upload.ts'
import { AvatarCropDialog } from './AvatarCropDialog.tsx'
import css from './ChannelsPage.module.css'

/** Which member the dialog edits; absent member means "add". */
export interface MemberDialogProps {
  readonly member: ChannelMember | undefined
  readonly members?: readonly ChannelMember[]
  readonly listPersonas?: () => Promise<readonly MemberPersona[]>
  readonly listModels: () => Promise<readonly ModelRoute[]>
  readonly listClis: () => Promise<readonly LocalCli[]>
  readonly onSubmit: (input: MemberInput) => Promise<void>
  readonly onClose: () => void
  readonly t: TranslateNS<typeof NS>
}

const SEP = '\u0000'

/** CLI choices offered for a local-CLI member, in display order (user request 2026-10-23). */
const CLI_CHOICES: readonly { readonly cli: string; readonly label: string }[] = [
  { cli: 'claude', label: 'Claude Code' },
  { cli: 'codex', label: 'Codex' },
  { cli: 'gemini', label: 'Gemini' },
]

const NO_MEMBERS: readonly ChannelMember[] = []

type MemberType = 'dsh' | 'cli'

/** DSH's built-in permission presets in DSH's own order; default = DSH default workspace-write (collab/cli-member.mjs DEFAULT_PERMISSION_PRESET). */
const PRESETS = [
  { id: 'read-only', label: 'permissionReadOnly', hint: 'permissionReadOnlyHint' },
  { id: 'workspace-write', label: 'permissionWorkspaceWrite', hint: 'permissionWorkspaceWriteHint' },
  { id: 'danger-full-access', label: 'permissionFullAccess', hint: 'permissionFullAccessHint' },
] as const satisfies readonly { readonly id: PermissionPreset; readonly label: string; readonly hint: string }[]
const DEFAULT_PRESET: PermissionPreset = 'workspace-write'

/**
 * Render the member dialog.
 * @param props - target member, actions, and copy.
 * @returns a modal form.
 */
export function MemberDialog({ member, members = NO_MEMBERS, listModels, listClis, listPersonas, onSubmit, onClose, t }: MemberDialogProps) {
  const [name, setName] = useState(member?.name ?? 'DSH')
  const [nameCustomized, setNameCustomized] = useState<boolean | undefined>(member === undefined ? false : member.nameCustomized)
  const [keepName, setKeepName] = useState(true)
  const [personas, setPersonas] = useState<readonly MemberPersona[]>([])
  const [personaSlug, setPersonaSlug] = useState('')
  const [persona, setPersona] = useState(member?.persona ?? '')
  const [modelKey, setModelKey] = useState(member?.model ? member.model.provider + SEP + member.model.model : '')
  const [routes, setRoutes] = useState<readonly ModelRoute[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // Editing keeps the member's kind, so changing only its avatar does not turn a CLI member into a model one.
  const [type, setType] = useState<MemberType>(member?.cli !== undefined ? 'cli' : 'dsh')
  const [clis, setClis] = useState<readonly LocalCli[] | undefined>(undefined)
  const [cli, setCli] = useState<string>(member?.cli ?? '')
  const [preset, setPreset] = useState<PermissionPreset>(member?.permissionPreset ?? DEFAULT_PRESET)
  const [avatar, setAvatar] = useState(member?.avatar ?? '')
  const [pendingPng, setPendingPng] = useState<string | undefined>()
  const [preview, setPreview] = useState<string | undefined>()
  const fileInput = useRef<HTMLInputElement>(null)
  const [cropImage, setCropImage] = useState<HTMLImageElement>()
  useEffect(() => () => { if (cropImage) URL.revokeObjectURL(cropImage.src) }, [cropImage])
  const selectAvatar = async (file: File): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try { setCropImage(await loadAvatar(file)) } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message === 'avatar-size' ? t('memberAvatarSizeError') : t('memberAvatarPngError'))
    } finally { setBusy(false) }
  }
  const changeAvatar = async (png?: string): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      if (member) {
        const updated = await uploadAvatar(member.id, png)
        setAvatar(updated.avatar ?? '')
      } else { setPendingPng(png); setAvatar('') }
      setPreview(png ? `data:image/png;base64,${png}` : undefined)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message === 'avatar-png' ? t('memberAvatarPngError') : message === 'avatar-size' ? t('memberAvatarSizeError') : message === 'avatar-convert' ? t('memberAvatarConvertError') : message)
    } finally { setBusy(false) }
  }

  const backend = type === 'cli' ? CLI_CHOICES.find(c => c.cli === cli)?.label ?? '' : 'DSH'
  useEffect(() => {
    if (nameCustomized !== false || !backend) return
    const used = new Set(members.filter(m => m.id !== member?.id).map(m => m.name.toLowerCase()))
    let next = backend
    for (let n = 2; used.has(next.toLowerCase()); n++) next = `${backend}-${n}`
    if (next === name) return
    if (keepName && persona) setPersona(text => renamePersonaIdentity(text, name, next))
    setName(next)
  }, [backend, nameCustomized, members, member?.id, name, keepName, persona])
  useEffect(() => {
    if (listPersonas) listPersonas().then(setPersonas).catch(reason => setError(String(reason)))
  }, [listPersonas])

  // One read of the host's model catalog per dialog opening.
  useEffect(() => {
    let live = true
    listModels().then((list) => { if (live) setRoutes(list) }).catch((reason: unknown) => {
      if (live) { setRoutes([]); setError(reason instanceof Error ? reason.message : String(reason)) }
    })
    return () => { live = false }
  }, [listModels])

  // Detect local CLIs once, the first time the "local CLI" type is picked.
  const wantClis = type === 'cli' && clis === undefined
  useEffect(() => {
    if (!wantClis) return
    let live = true
    listClis().then((list) => {
      if (!live) return
      setClis(list)
      setCli(prev => prev !== '' ? prev : CLI_CHOICES.find(c => list.some(l => l.cli === c.cli))?.cli ?? '')
    }).catch((reason: unknown) => {
      if (live) { setClis([]); setError(reason instanceof Error ? reason.message : String(reason)) }
    })
    return () => { live = false }
  }, [wantClis, listClis])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (busy || cropImage) return
    const [provider, model] = modelKey === '' ? [] : modelKey.split(SEP)
    setBusy(true)
    setError(undefined)
    const identity = nameCustomized === undefined ? {} : { nameCustomized }
    const input: MemberInput = type === 'cli'
      ? { name: name.trim(), ...identity, persona, avatar, ...(pendingPng ? { avatarPng: pendingPng } : {}), cli, permissionPreset: preset }
      : { name: name.trim(), ...identity, persona, avatar, ...(pendingPng ? { avatarPng: pendingPng } : {}), model: provider !== undefined && model !== undefined ? { provider, model } : null }
    onSubmit(input).then(onClose).catch((reason: unknown) => {
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
        onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      >
        <h2 className={css.dialogTitle}>{member === undefined ? t('memberDialogAdd') : t('memberDialogEdit', { name: member.name })}</h2>
        <p>{name === backend ? name : `${name}·${backend}`}</p>
        <p>{t('memberNoPersona')}</p>
        <details><summary>{t('memberOptional')}</summary>
        <label className={css.field}>
          <span>{t('memberName')}</span>
          <input className={css.fieldInput} value={name} maxLength={32} onChange={(event) => {
            const next = event.target.value
            if (personaSlug && keepName && name) setPersona(renamePersonaIdentity(persona, name, next))
            setName(next)
            setNameCustomized(true)
          }} />
        </label>

        <div className={css.field}>
          <span id="member-avatar-label">{t('memberAvatar')}</span>
          <span className={css.avatarPicker} role="radiogroup" aria-labelledby="member-avatar-label">
            {['', ...AVATARS].map(slug => (
              <button
                key={slug === '' ? 'none' : slug}
                type="button"
                role="radio"
                aria-checked={avatar === slug}
                className={css.avatarOption}
                title={slug === '' ? t('memberAvatarNone') : slug}
                disabled={busy}
                onClick={() => { setAvatar(slug); setPendingPng(undefined); setPreview(undefined) }}
              >
                <Avatar id={member?.id ?? (name.trim() || 'new')} name={name.trim() || '?'} avatar={slug} />
              </button>
            ))}
          </span>
          {(preview || avatar.startsWith('upload:')) && <span>{preview ? <img src={preview} width={64} height={64} alt={t('memberAvatarCustom')} /> : <Avatar id={member?.id ?? 'new'} name={name} avatar={avatar} />}</span>}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={t('memberAvatarUpload')} onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void selectAvatar(file)
          }} />
          <button type="button" disabled={busy} className={css.secondaryButton} onClick={() => fileInput.current?.click()}>{t('memberAvatarUpload')}</button>
          {(preview || avatar.startsWith('upload:')) && <button type="button" disabled={busy} className={css.secondaryButton} onClick={() => { void changeAvatar() }}>{t('memberAvatarReset')}</button>}
          <span>{t('memberAvatarHint')}</span>
        </div>
        <label className={css.field}><span><input type="checkbox" checked={keepName} onChange={e => setKeepName(e.target.checked)} />{t('memberKeepName')}</span></label>
        <select className={css.fieldInput} aria-label={t('memberPersonaLibrary')} value={personaSlug} onChange={e => {
          setPersonaSlug(e.target.value)
          const p = personas.find(p => p.slug === e.target.value)
          setPersona(p ? (keepName ? renamePersonaIdentity(p.text, p.name, name) : p.text) : '')
          if (p) { setAvatar(p.avatar || ''); if (!keepName) { setName(p.name); setNameCustomized(true) } }
        }}><option value="">{t('memberPersonaNone')}</option>{personas.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>
        <label className={css.field}><span>{t('memberPersona')}</span><textarea className={css.fieldInput} rows={4} value={persona} maxLength={4000} onChange={e => setPersona(e.target.value)} /></label>
        </details>
        {member === undefined && (
          <div className={css.field} role="radiogroup" aria-label={t('memberType')}>
            <span>{t('memberType')}</span>
            <span className={css.choiceRow}>
              {(['dsh', 'cli'] as const).map(value => (
                <label key={value} className={css.choice}>
                  <input type="radio" name="member-type" value={value} checked={type === value} onChange={() => { setType(value); setError(undefined) }} />
                  {value === 'dsh' ? t('memberTypeDsh') : t('memberTypeCli')}
                </label>
              ))}
            </span>
          </div>
        )}
        {type === 'cli' && (
          <div className={css.field} role="radiogroup" aria-label={t('memberCli')}>
            <span>{clis === undefined ? t('memberCliLoading') : t('memberCli')}</span>
            <span className={css.choiceRow}>
              {CLI_CHOICES.map(({ cli: id, label }) => {
                const found = clis?.find(l => l.cli === id)
                return (
                  <label key={id} className={css.choice} title={found?.path}>
                    <input type="radio" name="member-cli" value={id} checked={cli === id} disabled={found === undefined} onChange={() => { setCli(id) }} />
                    {found === undefined && clis !== undefined ? `${label} (${t('memberCliMissing')})` : label}
                  </label>
                )
              })}
            </span>
          </div>
        )}
        {type === 'cli' && (
          <label className={css.field}>
            <span>{t('memberPermission')}</span>
            <select className={css.fieldInput} aria-label={t('memberPermission')} value={preset} onChange={(event) => { setPreset(event.target.value as PermissionPreset) }}>
              {PRESETS.map(p => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
            </select>
            <span>{t(PRESETS.find(p => p.id === preset)?.hint ?? 'permissionWorkspaceWriteHint')}</span>
          </label>
        )}
        {type === 'dsh' && <label className={css.field}>
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
        </label>}
        {error !== undefined && <div className={css.sendError} role="alert">{error}</div>}
        <div className={css.dialogActions}>
          <button type="button" className={css.secondaryButton} onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className={css.primaryButton} disabled={busy || name.trim() === '' || (type === 'cli' && cli === '')}>{t('save')}</button>
        </div>
      </form>
      {cropImage && <AvatarCropDialog image={cropImage} t={t} onCancel={() => setCropImage(undefined)} onConfirm={png => {
        setCropImage(undefined)
        void changeAvatar(png)
      }} />}
    </div>
  )
}
