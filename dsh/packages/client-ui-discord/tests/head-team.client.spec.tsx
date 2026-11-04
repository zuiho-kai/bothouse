// @vitest-environment jsdom
// #125: teammates in the title bar with a busy/idle dot, from this channel's state only.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { HEAD_TEAM_MAX, headTeam } from '../src/client/HeadTeam.tsx'
import type { ChannelMember, ChannelSnapshot, ChannelTask } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const tr = (key: keyof typeof zh, values?: Record<string, unknown>): string => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))
const task = (id: number, owner: string, over: Partial<ChannelTask> = {}): ChannelTask => ({
  id, room_id: 2, parent_task: null, title: `任务${id}`, owner, owner_name: owner, created_by: 'me', created_by_name: '我',
  status: 'accepted', next_check_at: null, assign_msg_id: null, result_msg_id: null, note: null, created_at: 1, updated_at: id, returned_at: null, ...over,
})
const bot = (id: string, over: Partial<ChannelMember> = {}): ChannelMember => ({ id, name: id, kind: 'bot', online: true, ...over })
const members = [bot('lead'), bot('a'), bot('b'), bot('c', { error: '429' }), bot('d', { online: false }), { id: 'me', name: '我', kind: 'human', online: true } as ChannelMember]
const base: ChannelSnapshot = {
  phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }, { id: 2, name: '工作区1', kind: 'workspace', parent_id: 1 }, { id: 9, name: 'other', kind: 'chat' }], roomId: 1,
  members, thinking: { 2: ['b'] }, leadId: 'lead', effectiveLeadId: 'lead', messages: [], tasks: [task(7, 'a'), task(8, 'b', { room_id: 9 })],
}
function props(state: ChannelSnapshot): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, decidePermission: vi.fn(async () => {}), retryMessage: vi.fn(async () => {}),
    t: tr,
  } as unknown as ChannelsPageProps
}
const team = () => screen.getByRole('group', { name: zh.headTeam })

it('derives busy/idle/error/offline from this channel only, without the lead or humans', () => {
  const rooms = new Set([1, 2])
  const got = headTeam(members, 'lead', [task(7, 'a'), task(9, 'a', { paused_at: 5 }), task(8, 'b', { room_id: 9 })], { 2: ['b'] }, rooms)
  expect(got.map(m => [m.member.id, m.state, m.task?.id, m.replying])).toEqual([
    ['a', 'busy', 7, false], ['b', 'busy', undefined, true], ['c', 'error', undefined, false], ['d', 'offline', undefined, false],
  ])
  expect(headTeam([bot('x')], null, [task(8, 'x', { room_id: 9 })], {}, rooms)[0]?.state).toBe('idle')
})

it('shows each teammate with its dot and what it is on in the title bar', () => {
  render(<ChannelsPage {...props(base)} />)
  const a = within(team()).getByRole('button', { name: `a · ${zh.mateBusy} · ${tr('mateTask', { id: 7, title: '任务7' })}` })
  expect(a.dataset.state).toBe('busy')
  expect(within(team()).getByRole('button', { name: `b · ${zh.mateBusy} · ${zh.mateReplying}` }).dataset.state).toBe('busy')
  expect(within(team()).getByRole('button', { name: `c · ${zh.mateError}` }).dataset.state).toBe('error')
  expect(within(team()).getByRole('button', { name: `d · ${zh.mateOffline}` }).dataset.state).toBe('offline')
  expect(within(team()).queryByRole('button', { name: /^lead/ })).toBeNull()
})

it('caps the portraits and folds the rest into +n', () => {
  const many = [bot('lead'), ...Array.from({ length: HEAD_TEAM_MAX + 2 }, (_, i) => bot(`m${i}`))]
  render(<ChannelsPage {...props({ ...base, members: many, tasks: [], thinking: {} })} />)
  expect(within(team()).getAllByRole('button').length).toBe(HEAD_TEAM_MAX + 1)
  expect(within(team()).getByRole('button', { name: tr('headTeamMore', { count: 2 }) }).textContent).toBe('+2')
})

it('opens the activity column on click', () => {
  render(<ChannelsPage {...props(base)} />)
  const toggle = screen.getByRole('button', { name: zh.expandMembers })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(within(team()).getAllByRole('button')[0]!)
  expect(screen.getByRole('button', { name: zh.collapseMembers }).getAttribute('aria-expanded')).toBe('true')
})

it('opens the activity drawer on narrow screens', () => {
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: media === '(max-width: 900px)', addEventListener: () => {}, removeEventListener: () => {} }))
  render(<ChannelsPage {...props(base)} />)
  fireEvent.click(within(team()).getAllByRole('button')[0]!)
  expect(screen.getByRole('dialog', { name: zh.activityPanel })).toBeTruthy()
})
