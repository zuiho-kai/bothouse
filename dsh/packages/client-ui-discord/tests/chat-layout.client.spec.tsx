// @vitest-environment jsdom
// #113: where messages and cards sit — grouped runs, system dividers, inline failures,
// the permission tray above the composer, and the activity column.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, cardRole, continues, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelMessage, ChannelSnapshot } from '../src/client/channel-source.ts'
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
  expect(screen.getByText(zh.headBusy.replace('{names}', '鲸'))).toBeTruthy()
  // The workspace row keeps its plain name: the busy avatars are decorative.
  expect(screen.getByRole('button', { name: '工作区1' })).toBeTruthy()
})
