// @vitest-environment jsdom
// #125: the 本频道进展 card at the top of the log — 做完/在做/下一步/没定 from this channel's tasks only.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { channelProgress } from '../src/client/ProgressCard.tsx'
import type { ChannelSnapshot, ChannelTask } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const tr = (key: keyof typeof zh, values?: Record<string, unknown>): string => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))
const task = (id: number, over: Partial<ChannelTask> = {}): ChannelTask => ({
  id, room_id: 2, parent_task: null, title: `任务${id}`, owner: 'ju', owner_name: '橘', created_by: 'me', created_by_name: '我',
  status: 'accepted', next_check_at: null, assign_msg_id: 100 + id, result_msg_id: null, note: null, created_at: 1, updated_at: id, returned_at: null, ...over,
})
const base: ChannelSnapshot = {
  phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }, { id: 2, name: '工作区1', kind: 'workspace', parent_id: 1 }, { id: 9, name: 'other', kind: 'chat' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {}, leadId: 'ju', effectiveLeadId: 'ju', messages: [],
}
function props(state: ChannelSnapshot, over: Partial<ChannelsPageProps> = {}): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, decidePermission: vi.fn(async () => {}), retryMessage: vi.fn(async () => {}),
    t: tr, ...over,
  } as unknown as ChannelsPageProps
}
const card = () => screen.getByRole('region', { name: zh.progressTitle })
const row = (label: keyof typeof zh) => within(card()).getByText(zh[label]).parentElement!

it('sums up only this channel and its workspaces, newest task per row', () => {
  const lines = channelProgress([
    task(1, { status: 'done' }), task(4, { status: 'done' }), task(2), task(3, { status: 'rework' }),
    task(5, { status: 'accepted', paused_at: 9 }), task(6, { status: 'asked' }), task(7, { status: 'done', room_id: 9 }),
  ], new Set([1, 2]))
  expect(lines.map(l => [l.row, l.task?.id, l.count])).toEqual([['done', 4, 2], ['doing', 3, 2], ['next', 5, 1], ['open', 6, 1]])
})

it('puts a hand-back to accept ahead of a parked task as the next step', () => {
  const lines = channelProgress([task(5, { paused_at: 9, updated_at: 50 }), task(8, { status: 'returned' })], new Set([2]))
  expect(lines.find(l => l.row === 'next')?.task?.id).toBe(8)
})

it('shows nothing for a channel without tasks', () => {
  expect(channelProgress([task(7, { room_id: 9 })], new Set([1, 2]))).toEqual([])
  render(<ChannelsPage {...props({ ...base, tasks: [task(7, { room_id: 9 })] })} />)
  expect(screen.queryByRole('region', { name: zh.progressTitle })).toBeNull()
})

it('renders the rows that have a task at the top of the log and hides the empty ones (#1017)', () => {
  render(<ChannelsPage {...props({ ...base, tasks: [task(2), task(3), task(8, { status: 'returned' })] })} />)
  expect(card().closest('[role="log"]')).toBeTruthy()
  expect(card().querySelector('[data-row="done"]')).toBeNull()
  expect(row('progressDoing').textContent).toContain(tr('progressTask', { id: 3, title: '任务3', name: '橘' }) + tr('progressMore', { count: 1 }))
  expect(row('progressNext').textContent).toContain(tr('progressNextReview', { id: 8, title: '任务8', name: '橘' }))
  expect(card().querySelector('[data-row="open"]')).toBeNull()
})

it('jumps to the task dispatch message when a row is clicked', () => {
  const selectRoom = vi.fn()
  render(<ChannelsPage {...props({ ...base, tasks: [task(6, { status: 'asked' })] }, { selectRoom })} />)
  fireEvent.click(within(row('progressOpen')).getByRole('button'))
  expect(selectRoom).toHaveBeenCalledWith(2)
})
