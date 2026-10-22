import type { KeyboardEvent, RefObject } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelMember } from '../channel-source.ts'
import type { NS } from '../locales.ts'
import { Avatar } from './Avatar.tsx'
import { KindTag } from './KindTag.tsx'
import css from '../ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

function MemberGroup({ title, members, busy, onPick, onEdit, onRemove, t }: {
  title: string
  members: readonly ChannelMember[]
  busy: ReadonlySet<string>
  onPick: (member: ChannelMember) => void
  onEdit: (member: ChannelMember) => void
  onRemove: (member: ChannelMember) => void
  t: T
}) {
  if (members.length === 0) return null
  return (
    <>
      <h3 className={css.groupTitle}>{title}</h3>
      {members.map(m => (
        <div key={m.id} className={m.online ? css.memberRow : `${css.memberRow} ${css.offline}`}>
          <button
            type="button"
            className={css.member}
            title={t('mentionPick', { name: m.name })}
            onClick={() => { onPick(m) }}
          >
            <span className={css.memberAvatar}>
              <Avatar id={m.id} name={m.name} small />
              <span className={css.presence} />
            </span>
            <span className={css.memberText}>
              <span className={css.memberName}>{m.name}<KindTag kind={m.kind} t={t} /></span>
              <span className={css.memberStatus}>{busy.has(m.id) ? t('working') : m.online ? t('online') : t('offline')}</span>
              {m.kind === 'dsh' && (
                <span className={css.memberModel}>{m.model ? `${m.model.provider}/${m.model.model}` : t('defaultModel')}</span>
              )}
            </span>
          </button>
          {m.kind === 'dsh' && (m.editable === true
            ? (
                <span className={css.memberActions}>
                  <button type="button" className={css.linkButton} onClick={() => { onEdit(m) }}>{t('editMember')}</button>
                  <button type="button" className={css.linkButton} onClick={() => { onRemove(m) }}>{t('removeMember')}</button>
                </span>
              )
            : <span className={css.memberActions} title={t('configMember')}>⚙</span>)}
        </div>
      ))}
    </>
  )
}

export interface MemberPanelProps {
  members: readonly ChannelMember[]
  busy: ReadonlySet<string>
  isOpenOnMobile: boolean
  drawerRef?: RefObject<HTMLElement | null>
  memberError: string | undefined
  onAddMember: () => void
  onPickMember: (member: ChannelMember) => void
  onEditMember: (member: ChannelMember) => void
  onRemoveMember: (member: ChannelMember) => void
  onCloseDrawer: () => void
  t: T
}

export function MemberPanel({
  members,
  busy,
  isOpenOnMobile,
  drawerRef,
  memberError,
  onAddMember,
  onPickMember,
  onEditMember,
  onRemoveMember,
  onCloseDrawer,
  t,
}: MemberPanelProps) {
  const agentMembers = members.filter(m => m.kind !== 'human')
  const humanMembers = members.filter(m => m.kind === 'human')

  const onDrawerKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCloseDrawer()
    }
  }

  return (
    <aside
      ref={drawerRef}
      tabIndex={-1}
      className={isOpenOnMobile ? `${css.members} ${css.drawerOpen}` : css.members}
      aria-label={t('panel')}
      onKeyDown={onDrawerKeyDown}
    >
      <div className={css.memberPanelHead}>
        <button type="button" className={css.addMemberButton} onClick={onAddMember}>
          + {t('addMember')}
        </button>
        {isOpenOnMobile && (
          <button
            type="button"
            className={css.drawerCloseButton}
            title={t('closeDrawer')}
            aria-label={t('closeDrawer')}
            onClick={onCloseDrawer}
          >
            ✕
          </button>
        )}
      </div>
      {memberError !== undefined && <div className={css.sendError} role="alert">{memberError}</div>}
      <MemberGroup
        title={t('agents', { count: String(agentMembers.length) })}
        members={agentMembers}
        busy={busy}
        onPick={onPickMember}
        onEdit={onEditMember}
        onRemove={onRemoveMember}
        t={t}
      />
      <MemberGroup
        title={t('humans', { count: String(humanMembers.length) })}
        members={humanMembers}
        busy={busy}
        onPick={onPickMember}
        onEdit={onEditMember}
        onRemove={onRemoveMember}
        t={t}
      />
    </aside>
  )
}
