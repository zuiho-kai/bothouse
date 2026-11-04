// @vitest-environment jsdom
// #113: where messages and cards sit — grouped runs, system dividers, inline failures,
// the permission tray above the composer, and the activity column.
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelsPage, cardRole, continues, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelMessage, ChannelSnapshot, ChannelTask } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'
import css from '../src/client/ChannelsPage.module.css'

afterEach(cleanup)

const msg = (id: number, over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: `m${id}`, created_at: id * 10, card: null, from_turn: null, ...over,
})
const base: ChannelSnapshot = {
  phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }, { id: 2, name: '工作区1', kind: 'workspace', parent_id: 1 }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }, { id: 'ds', name: '鲸', kind: 'dsh', online: true }], thinking: {},
  leadId: 'ju', effectiveLeadId: 'ju', messages: [],
}
function props(state: ChannelSnapshot, over: Partial<ChannelsPageProps> = {}): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, decidePermission: vi.fn(async () => {}), retryMessage: vi.fn(async () => {}),
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
      .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
    ...over,
  } as unknown as ChannelsPageProps
}

it('classifies cards by where they sit', () => {
  expect(cardRole(undefined)).toBe('none')
  expect(cardRole({ title: 'a · 处理中', state: 'running', steps: 2 })).toBe('progress')
  expect(cardRole({ title: 'job', state: 'running' })).toBe('progress')
  expect(cardRole({ title: '成员出错', state: 'failed', action: 'configure-model' })).toBe('failure')
  expect(cardRole({ kind: 'permission', state: 'pending' })).toBe('permission')
  expect(cardRole({ kind: 'task', task_id: 1 })).toBe('task')
  expect(cardRole({ title: 'approval' })).toBe('other')
})

it('groups a run of one author within five minutes, but not across a reply, a system line or a gap', () => {
  expect(continues(msg(1), msg(2))).toBe(true)
  expect(continues(msg(1), msg(2, { card: JSON.stringify({ title: 'x', state: 'running', steps: 1 }) }))).toBe(true)
  expect(continues(msg(1), msg(2, { author: 'ds', name: '鲸' }))).toBe(false)
  expect(continues(msg(1), msg(2, { reply_to: { id: 1, author_kind: 'role', author: 'ju', name: '橘', text: 'x' } }))).toBe(false)
  expect(continues(msg(1, { author_kind: 'system', author: 'system' }), msg(2, { author_kind: 'system', author: 'system' }))).toBe(false)
  expect(continues(msg(1), msg(400))).toBe(false)
  expect(continues(msg(1), msg(2, { card: JSON.stringify({ kind: 'permission', state: 'pending' }) }))).toBe(false)
})

it('shows a grouped message without repeating the author, and a system notice as a divider', () => {
  const view = render(<ChannelsPage {...props({ ...base, messages: [msg(1), msg(2), msg(3, { author_kind: 'system', author: 'system', name: '任务提醒', text: '到了检查时间' })] })} />)
  const row = (id: number) => view.container.querySelector(`[data-message-id="${id}"]`) as HTMLElement
  expect(row(1).querySelector(`.${css.author}`)?.textContent).toBe('橘')
  expect(row(2).querySelector(`.${css.author}`)).toBeNull()
  expect(row(2).querySelector('[aria-haspopup="menu"]')).toBeNull()
  expect(within(row(2)).getByText('m2')).toBeTruthy()
  expect(row(3).getAttribute('role')).toBe('note')
  expect(within(row(3)).queryByText('任务提醒')).toBeNull()
})

it('shows a member failure as an inline bar with retry', () => {
  const retryMessage = vi.fn(async () => {})
  const card = JSON.stringify({ title: '成员出错', state: 'failed', action: 'configure-model' })
  const view = render(<ChannelsPage {...props({ ...base, messages: [msg(1, { author_kind: 'system', author: 'system', name: 'system', text: '中转站返回 429', card })] }, { retryMessage })} />)
  const bar = view.container.querySelector('[data-message-id="1"]') as HTMLElement
  expect(bar.getAttribute('role')).toBe('alert')
  fireEvent.click(within(bar).getByRole('button', { name: zh.retry }))
  expect(retryMessage).toHaveBeenCalledWith(1)
})

it('pins a pending permission request above the composer and leaves a line in the log', () => {
  const decidePermission = vi.fn(async () => {})
  const card = JSON.stringify({ kind: 'permission', title: '权限请求', state: 'pending', actions: [{ decision: 'allow', label: '允许' }, { decision: 'deny', label: '拒绝' }] })
  const view = render(<ChannelsPage {...props({ ...base, messages: [msg(1, { text: '想运行 rm', card })] }, { decidePermission })} />)
  const log = screen.getByRole('log')
  expect(within(log).queryByRole('button', { name: '允许' })).toBeNull()
  expect(within(log).getByText(zh.permPending)).toBeTruthy()
  const tray = screen.getByRole('region', { name: zh.permTray.replace('{count}', '1') })
  expect(tray.compareDocumentPosition(screen.getByRole('combobox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(within(tray).getByRole('button', { name: '允许' }))
  expect(decidePermission).toHaveBeenCalledWith(1, 'allow')
  // Decided: the tray goes away and the log keeps the outcome.
  view.rerender(<ChannelsPage {...props({ ...base, messages: [msg(1, { text: '想运行 rm', card: JSON.stringify({ kind: 'permission', state: 'allowed', actions: [] }) })] }, { decidePermission })} />)
  expect(screen.queryByRole('region', { name: zh.permTray.replace('{count}', '1') })).toBeNull()
  expect(within(screen.getByRole('log')).getByText(zh.permAllowed)).toBeTruthy()
})

it('lists who is at work in the channel and its workspaces in the activity column and title bar', () => {
  render(<ChannelsPage {...props({ ...base, thinking: { 2: ['ds'] } })} />)
  const now = screen.getByRole('region', { name: zh.activityNow })
  expect(now.querySelector(`.${css.activityName}`)?.textContent).toBe('鲸')
  expect(within(now).getByText(`${zh.activityThinking} · 工作区1`)).toBeTruthy()
  // The header identifies the actual primary role; another member's work stays in Activity.
  const lead = screen.getByRole('group', { name: zh.headLead })
  expect(lead.querySelector(`.${css.headLeadName}`)?.textContent).toBe('橘')
  expect(within(lead).getByText(zh.headLeadIdle)).toBeTruthy()
  // 白色方案：左栏置顶卡与右上胶囊显示同一主角色和状态。
  const pinned = screen.getByRole('group', { name: zh.leadCard })
  expect(pinned.querySelector(`.${css.leadCardName}`)?.textContent).toBe('橘')
  expect(within(pinned).getByText(`${zh.leadPinned} · ${zh.headLeadIdle}`)).toBeTruthy()
  // The workspace row keeps its plain name: the busy avatars are decorative.
  expect(screen.getByRole('button', { name: '工作区1' })).toBeTruthy()
})

it('leaves a task parked by the hourly wrap-up out of Activity and the busy marks, like the board (paused_at)', () => {
  const task = (id: number, over: Partial<ChannelTask> = {}): ChannelTask => ({
    id, room_id: 2, parent_task: null, title: `任务${id}`, owner: 'ds', owner_name: '鲸', created_by: 'ju', created_by_name: '橘',
    status: 'accepted', next_check_at: null, assign_msg_id: null, result_msg_id: null, created_at: 1, updated_at: 1, paused_at: null, ...over,
  } as ChannelTask)
  const view = render(<ChannelsPage {...props({ ...base, tasks: [task(7, { paused_at: 100 })] })} />)
  expect(screen.queryByRole('region', { name: zh.activityNow })).toBeNull()
  const row = (name: string) => [...view.container.querySelectorAll(`.${css.memberStatus}`)].find(el => el.closest('li,button,div')?.textContent?.includes(name))
  expect(row('鲸')?.getAttribute('data-status')).toBe('online')
  // Resumed (paused_at cleared): it is live work again.
  view.rerender(<ChannelsPage {...props({ ...base, tasks: [task(7)] })} />)
  expect(within(screen.getByRole('region', { name: zh.activityNow })).getByText('#7 任务7 · 工作区1')).toBeTruthy()
  expect(row('鲸')?.getAttribute('data-status')).toBe('busy')
})

describe('live header integration (#113)', () => {
  it('shows the channel effective lead and work across its workspaces, not the global role', () => {
    const view = render(<ChannelsPage {...props({ ...base, rooms: [{ ...base.rooms[0], effective_lead_id: 'ds' }, base.rooms[1]], thinking: { 2: ['ds'] } })} />)
    const lead = screen.getByRole('group', { name: zh.headLead })
    expect(lead.querySelector(`.${css.headLeadName}`)?.textContent).toBe('鲸')
    expect(within(lead).getByText(zh.headLeadBusyUnreported)).toBeTruthy()
    expect(within(lead).queryByText('橘')).toBeNull()
    view.rerender(<ChannelsPage {...props({ ...base, rooms: [{ ...base.rooms[0], effective_lead_id: 'ds' }, base.rooms[1]], thinking: { 9: ['ds'] } })} />)
    expect(within(screen.getByRole('group', { name: zh.headLead })).getByText(zh.headLeadIdle)).toBeTruthy()
  })

  it('does not invent a lead when the room explicitly has none: says no lead is set', () => {
    render(<ChannelsPage {...props({ ...base, rooms: [{ ...base.rooms[0], effective_lead_id: null }] })} />)
    const head = screen.getByRole('group', { name: zh.headLead })
    expect(within(head).getByText(zh.headLeadUnset)).toBeTruthy()
    expect(within(head).queryByText('橘')).toBeNull()
    expect(within(screen.getByRole('group', { name: zh.leadCard })).getByText(`${zh.leadPinned} · ${zh.headLeadUnset}`)).toBeTruthy()
  })

  it('says the lead is still loading when it is not among the members yet', () => {
    render(<ChannelsPage {...props({ ...base, leadId: 'ghost', effectiveLeadId: 'ghost' })} />)
    expect(within(screen.getByRole('group', { name: zh.headLead })).getByText(zh.headLeadLoading)).toBeTruthy()
    expect(within(screen.getByRole('group', { name: zh.leadCard })).getByText(`${zh.leadPinned} · ${zh.headLeadLoading}`)).toBeTruthy()
  })

  it('names the task the lead is on, from the board, in the capsule and the pinned card', () => {
    const task = (id: number, over: Record<string, unknown>) => ({ id, room_id: 2, parent_task: null, title: `任务${id}`, owner: 'ju', owner_name: '橘', created_by: 'me', created_by_name: '我', status: 'accepted', next_check_at: null, assign_msg_id: null, result_msg_id: null, note: null, created_at: 1, updated_at: id, returned_at: null, ...over })
    render(<ChannelsPage {...props({ ...base, thinking: { 2: ['ju'] }, tasks: [task(1, {}), task(2, { status: 'returned' }), task(3, { paused_at: 5 }), task(4, { room_id: 99 })] } as ChannelSnapshot)} />)
    expect(within(screen.getByRole('group', { name: zh.headLead })).getByText('#1 任务1')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: zh.leadCard })).getByText(`${zh.leadPinned} · #1 任务1`)).toBeTruthy()
  })

  it('falls back to the running progress card brief when the lead has no task', () => {
    const card = JSON.stringify({ title: '橘 · 处理中', state: 'running', steps: 3, brief: '第 3 步 · 12秒\n⏳ bash · 进行中\n' })
    render(<ChannelsPage {...props({ ...base, thinking: { 1: ['ju'] }, messages: [msg(1, { card })] })} />)
    expect(within(screen.getByRole('group', { name: zh.headLead })).getByText('⏳ bash · 进行中')).toBeTruthy()
  })

  it.each([
    { online: false, error: undefined, status: zh.offline },
    { online: true, error: 'unavailable', status: zh.memberFailed },
  ])('keeps a primary role status truthful: $status', ({ online, error, status }) => {
    render(<ChannelsPage {...props({ ...base, members: [{ ...base.members[0], online, error }] })} />)
    expect(within(screen.getByRole('group', { name: zh.headLead })).getByText(status)).toBeTruthy()
  })

  it('keeps the existing collab board available in the header while Activity starts collapsed', () => {
    const view = render(<ChannelsPage {...props(base)} />)
    expect(view.container.firstElementChild?.classList.contains(css.membersHidden)).toBe(true)
    expect(screen.getByRole('button', { name: zh.expandMembers }).getAttribute('aria-expanded')).toBe('false')
    const board = screen.getByRole('button', { name: zh.taskBoardOpen })
    expect(view.container.querySelector('header')?.contains(board)).toBe(true)
    fireEvent.click(board)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: zh.close }))
    expect(view.container.firstElementChild?.classList.contains(css.membersHidden)).toBe(true)
  })
})

describe('mobile drawer focus lifecycle (#117)', () => {
  beforeEach(() => {
    // jsdom has no layout; browser regressions separately check real visibility.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it.each(['rooms', 'members'] as const)('takes focus, traps Tab and restores the %s opener on Escape', kind => {
    const view = render(<ChannelsPage {...props(base)} />)
    const opener = screen.getByRole('button', { name: kind === 'rooms' ? zh.showRooms : zh.showMembers })
    fireEvent.click(opener)
    const drawer = screen.getByRole('dialog', { name: kind === 'rooms' ? zh.rooms : zh.activityPanel })
    expect(drawer.contains(document.activeElement)).toBe(true)
    expect(view.container.querySelector('section')?.inert).toBe(true)
    const controls = Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled)'))
    controls[controls.length - 1]?.focus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' })
    expect(document.activeElement).toBe(controls[0])
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(controls[controls.length - 1])
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(view.container.querySelector('section')?.inert).toBeFalsy()
  })

  it('restores the room opener after selecting a room or pressing the backdrop', () => {
    const selectRoom = vi.fn()
    render(<ChannelsPage {...props(base, { selectRoom })} />)
    const opener = screen.getByRole('button', { name: zh.showRooms })
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'general' }))
    expect(selectRoom).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(opener)
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: zh.closeDrawer }))
    expect(document.activeElement).toBe(opener)
  })

  it('returns to the activity opener when a settings dialog closes after the drawer', () => {
    render(<ChannelsPage {...props(base)} />)
    const opener = screen.getByRole('button', { name: zh.showMembers })
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: zh.channelSettings }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
  })
})

it.each(['Escape', 'Enter'])('returns to the recreated edit button after %s', async key => {
  const editMessage = vi.fn(async () => {})
  render(<ChannelsPage {...props({ ...base, messages: [msg(1, { author_kind: 'user', author: 'me', name: '我' })] }, { editMessage })} />)
  fireEvent.click(screen.getByRole('button', { name: zh.messageEdit }))
  const editor = screen.getByRole('textbox', { name: zh.messageEdit })
  fireEvent.change(editor, { target: { value: 'changed' } })
  fireEvent.keyDown(editor, { key })
  await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.messageEdit })) })
  expect(editMessage).toHaveBeenCalledTimes(key === 'Enter' ? 1 : 0)
})
