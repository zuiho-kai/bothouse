/**
 * Teammate portraits in the title bar, each with a busy/idle dot (#125, the owner's 11:53 sample
 * v1: 顶栏队友头像带忙闲点). The lead is left out (it has its own capsule beside them). States come
 * from the snapshot only:
 * - error: the member reports an error; offline: not online;
 * - busy: replying in this channel or one of its workspaces, or holding a live task there;
 * - idle: otherwise.
 * A click opens the activity column, where the member list says more.
 */
import type { ChannelMember, ChannelTask } from './channel-source.ts'
import { isLiveTask, type T } from './task-board.ts'
import { Avatar } from './Avatar.tsx'
import css from './ChannelsPage.module.css'

export type MateState = 'busy' | 'idle' | 'error' | 'offline'
export interface Mate { readonly member: ChannelMember; readonly state: MateState; readonly task?: ChannelTask; readonly replying: boolean }

// 来源：用户 11:53 样张 v1 顶栏显示 4 位队友。
export const HEAD_TEAM_MAX = 4

export function headTeam(members: readonly ChannelMember[], leadId: string | null | undefined, tasks: readonly ChannelTask[], thinking: Readonly<Record<string, readonly string[]>>, rooms: ReadonlySet<number>): Mate[] {
  return members.filter(m => m.kind !== 'human' && m.id !== leadId).map((member) => {
    const replying = [...rooms].some(id => (thinking[String(id)] ?? []).includes(member.id))
    const task = tasks.filter(t => t.owner === member.id && rooms.has(t.room_id) && isLiveTask(t)).sort((a, b) => b.updated_at - a.updated_at)[0]
    const state: MateState = member.error ? 'error' : !member.online ? 'offline' : replying || task !== undefined ? 'busy' : 'idle'
    return { member, state, task, replying }
  })
}

const STATE_KEY = { busy: 'mateBusy', idle: 'mateIdle', error: 'mateError', offline: 'mateOffline' } as const

export function mateLabel(mate: Mate, t: T): string {
  const doing = mate.task !== undefined ? t('mateTask', { id: String(mate.task.id), title: mate.task.title }) : mate.replying ? t('mateReplying') : ''
  return [mate.member.name, t(STATE_KEY[mate.state]), doing].filter(Boolean).join(' · ')
}

export function HeadTeam({ mates, t, onOpen }: { mates: readonly Mate[]; t: T; onOpen: () => void }) {
  if (mates.length === 0) return null
  const shown = mates.slice(0, HEAD_TEAM_MAX)
  const rest = mates.length - shown.length
  return (
    <div className={css.headTeam} role="group" aria-label={t('headTeam')}>
      {shown.map(mate => {
        const label = mateLabel(mate, t)
        return (
          <button key={mate.member.id} type="button" className={css.mate} data-state={mate.state} title={label} aria-label={label} onClick={onOpen}>
            <Avatar id={mate.member.id} name={mate.member.name} avatar={mate.member.avatar} avatarVersion={mate.member.avatarVersion} small />
            <span className={css.mateDot} aria-hidden />
          </button>
        )
      })}
      {rest > 0 && <button type="button" className={css.mateMore} title={mates.slice(HEAD_TEAM_MAX).map(m => mateLabel(m, t)).join('\n')} aria-label={t('headTeamMore', { count: String(rest) })} onClick={onOpen}>+{rest}</button>}
    </div>
  )
}
