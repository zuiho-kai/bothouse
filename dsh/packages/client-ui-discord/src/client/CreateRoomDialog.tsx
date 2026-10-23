/**
 * Create room dialog: channel name, visibility (public vs private), and
 * initial member selection for private channels.
 */
import { useState, type FormEvent } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember } from './channel-source.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

export interface CreateRoomDialogProps {
  readonly members: readonly ChannelMember[]
  readonly onSubmit: (name: string, visibility: 'public' | 'private', initialMembers?: readonly string[]) => Promise<void>
  readonly onClose: () => void
  readonly t: TranslateNS<typeof NS>
}

const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#00a8fc', '#9b59b6', '#e67e22']

function color(id: string): string {
  // 沿用 ChannelsPage 的颜色哈希初始种子
  let h = 7
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] as string
}

function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <span className={`${css.avatar} ${css.avatarSmall}`} style={{ background: color(id) }} aria-hidden>
      {(name || id).slice(0, 1)}
    </span>
  )
}

function KindTag({ kind, t }: { kind: ChannelMember['kind'] | undefined; t: TranslateNS<typeof NS> }) {
  if (kind === 'dsh') return <span className={css.tag}>{t('kindDsh')}</span>
  if (kind === 'bot') return <span className={css.tag}>{t('kindBot')}</span>
  return null
}

export function CreateRoomDialog({ members, onSubmit, onClose, t }: CreateRoomDialogProps) {
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [selectedMembers, setSelectedMembers] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // Filter out human owner from selection since owner is always implicitly in room
  const candidates = members.filter(m => m.id !== 'owner')

  const toggleMember = (id: string): void => {
    const next = new Set(selectedMembers)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedMembers(next)
  }

  const submit = (event?: FormEvent): void => {
    if (event) event.preventDefault()
    const cleanName = name.trim().replace(/^#/, '')
    if (busy || cleanName === '') return
    setBusy(true)
    setError(undefined)
    const initial = visibility === 'private' ? [...selectedMembers] : undefined
    onSubmit(cleanName, visibility, initial)
      .then(onClose)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className={css.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('createRoomModalTitle')}
        onSubmit={submit}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      >
        <h2 className={css.dialogTitle}>{t('createRoomModalTitle')}</h2>
        <label className={css.field}>
          <span>{t('newRoomPlaceholder')}</span>
          <input
            className={css.fieldInput}
            value={name}
            maxLength={32}
            autoFocus
            aria-label={t('newRoom')}
            placeholder={t('newRoomPlaceholder')}
            onChange={(event) => { setName(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit(event)
              }
            }}
          />
        </label>
        <div className={css.field}>
          <span>{t('visibility')}</span>
          <div className={css.radioGroup}>
            <label className={css.radioLabel}>
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === 'public'}
                onChange={() => { setVisibility('public') }}
              />
              <span>{t('roomTypePublic')}</span>
            </label>
            <label className={css.radioLabel}>
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={visibility === 'private'}
                onChange={() => { setVisibility('private') }}
              />
              <span>{t('roomTypePrivate')}</span>
            </label>
          </div>
        </div>
        {visibility === 'private' && (
          <div className={css.field}>
            <span>{t('initialMembers')}</span>
            <div className={css.memberSelectList}>
              {candidates.length === 0 ? (
                <div className={css.emptyHint}>{t('empty')}</div>
              ) : (
                candidates.map(m => (
                  <label key={m.id} className={css.memberCheckItem}>
                    <input
                      type="checkbox"
                      checked={selectedMembers.has(m.id)}
                      onChange={() => { toggleMember(m.id) }}
                    />
                    <Avatar id={m.id} name={m.name} />
                    <span className={css.memberCheckName}>{m.name}</span>
                    <KindTag kind={m.kind} t={t} />
                  </label>
                ))
              )}
            </div>
          </div>
        )}
        {error !== undefined && <div className={css.sendError} role="alert">{error}</div>}
        <div className={css.dialogActions}>
          <button type="button" className={css.secondaryButton} onClick={onClose}>{t('cancel')}</button>
          <button type="submit" className={css.primaryButton} disabled={busy || name.trim() === ''}>{t('create')}</button>
        </div>
      </form>
    </div>
  )
}
