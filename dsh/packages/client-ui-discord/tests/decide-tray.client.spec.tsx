// @vitest-environment jsdom
// #125: the 等你定 tray above the composer — members' questions with a direct reply and ↑ send
// button, the permission list under the same folding header, and an honest notice while the
// reply endpoint is not live.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { UNDO_SECONDS, openQuestions } from '../src/client/DecideTray.tsx'
import type { ChannelMessage, ChannelSnapshot, ChannelTask } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

const tr = (key: keyof typeof zh, values?: Record<string, unknown>): string => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))
const task = (id: number, over: Partial<ChannelTask> = {}): ChannelTask => ({
  id, room_id: 2, parent_task: null, title: `任务${id}`, owner: 'ju', owner_name: '橘', created_by: 'me', created_by_name: '我',
  status: 'asked', next_check_at: null, assign_msg_id: null, result_msg_id: null, note: `问题${id}`, created_at: 1, updated_at: id, returned_at: null, ...over,
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
const tray = () => screen.getByRole('region', { name: zh.decideTray })

it('lists open questions of this channel and its workspaces, oldest first, not parked or answered ones', () => {
  const rooms = new Set([1, 2])
  const got = openQuestions([task(3), task(1), task(2, { status: 'accepted' }), task(4, { paused_at: 5 }), task(5, { room_id: 9 })], rooms)
  expect(got.map(x => x.id)).toEqual([1, 3])
})

it('pins questions above the composer with the question text, who asks and the task', () => {
  render(<ChannelsPage {...props({ ...base, tasks: [task(7, { note: '左栏收成抽屉还是隐藏？' })] })} />)
  const region = tray()
  expect(region.compareDocumentPosition(screen.getByRole('combobox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(region).getByText(tr('trayAsks', { count: 1 }))).toBeTruthy()
  expect(within(region).getByText('左栏收成抽屉还是隐藏？')).toBeTruthy()
  expect(within(region).getByText(tr('askFrom', { name: '橘', id: 7, title: '任务7' }))).toBeTruthy()
})

it('shows no tray when nothing waits', () => {
  render(<ChannelsPage {...props({ ...base, tasks: [task(7, { status: 'accepted' })] })} />)
  expect(screen.queryByRole('region', { name: zh.decideTray })).toBeNull()
})

it('folds questions and permissions under one header', () => {
  const card = JSON.stringify({ kind: 'permission', state: 'pending', actions: [{ decision: 'allow', label: '允许' }] })
  const msg: ChannelMessage = { id: 1, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '想运行 rm', created_at: 1, card, from_turn: null }
  render(<ChannelsPage {...props({ ...base, messages: [msg], tasks: [task(7)] })} />)
  const head = within(tray()).getByRole('button', { name: new RegExp(tr('trayAsks', { count: 2 })) })
  expect(head.getAttribute('aria-expanded')).toBe('true')
  expect(within(tray()).getByRole('button', { name: zh.permAllowOnce })).toBeTruthy()
  fireEvent.click(head)
  expect(head.getAttribute('aria-expanded')).toBe('false')
  expect(within(tray()).queryByRole('button', { name: zh.permAllowOnce })).toBeNull()
  expect(within(tray()).queryByRole('textbox')).toBeNull()
  fireEvent.click(head)
  expect(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) })).toBeTruthy()
})

it('keeps a draft while the tray is folded', () => {
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] })} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  const head = within(tray()).getByRole('button', { name: new RegExp(tr('trayAsks', { count: 1 })) })
  fireEvent.click(head)
  fireEvent.click(head)
  expect((within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }) as HTMLInputElement).value).toBe('抽屉')
})

it('still sends a counting-down reply when the tray is folded meanwhile', async () => {
  vi.useFakeTimers()
  const answerTask = vi.fn(async () => {})
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] }, { answerTask })} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  fireEvent.click(within(tray()).getByRole('button', { name: zh.askSend }))
  fireEvent.click(within(tray()).getByRole('button', { name: new RegExp(tr('trayAsks', { count: 1 })) }))
  await act(async () => { vi.advanceTimersByTime(UNDO_SECONDS * 1000) })
  expect(answerTask).toHaveBeenCalledWith(7, '抽屉')
})

it('keeps a counting-down reply undoable after the task leaves asked', async () => {
  vi.useFakeTimers()
  const answerTask = vi.fn(async () => {})
  const p = props({ ...base, tasks: [task(7)] }, { answerTask })
  const view = render(<ChannelsPage {...p} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  fireEvent.click(within(tray()).getByRole('button', { name: zh.askSend }))
  view.rerender(<ChannelsPage {...props({ ...base, tasks: [task(7, { status: 'accepted' })] }, { answerTask })} />)
  await act(async () => { vi.advanceTimersByTime(1000) })
  fireEvent.click(within(tray()).getByRole('button', { name: tr('askUndo', { n: UNDO_SECONDS - 1 }) }))
  await act(async () => { vi.advanceTimersByTime(UNDO_SECONDS * 1000) })
  expect(answerTask).not.toHaveBeenCalled()
})

it('shows the failure of a reply whose task already left asked', async () => {
  vi.useFakeTimers()
  const answerTask = vi.fn(async () => { throw new Error('HTTP 409') })
  const view = render(<ChannelsPage {...props({ ...base, tasks: [task(7)] }, { answerTask })} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  fireEvent.click(within(tray()).getByRole('button', { name: zh.askSend }))
  view.rerender(<ChannelsPage {...props({ ...base, tasks: [task(7, { status: 'accepted' })] }, { answerTask })} />)
  await act(async () => { vi.advanceTimersByTime(UNDO_SECONDS * 1000) })
  expect(answerTask).toHaveBeenCalledWith(7, '抽屉')
  expect(within(tray()).getByRole('alert').textContent).toBe('HTTP 409')
})

it('greys the ↑ send button while the reply is empty', () => {
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] })} />)
  const send = within(tray()).getByRole('button', { name: zh.askSend }) as HTMLButtonElement
  expect(send.disabled).toBe(true)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '  ' } })
  expect(send.disabled).toBe(true)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  expect(send.disabled).toBe(false)
})

it('says the endpoint is being fixed instead of faking a delivery, and keeps the text', () => {
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] })} />)
  const input = within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '抽屉' } })
  fireEvent.click(within(tray()).getByRole('button', { name: zh.askSend }))
  expect(within(tray()).getByText(zh.askApiPending)).toBeTruthy()
  expect(within(tray()).queryByText(tr('askReplied', { text: '抽屉' }))).toBeNull()
  expect(input.value).toBe('抽屉')
})

it('sends on Enter after the undo window, and shows the reply in place', async () => {
  vi.useFakeTimers()
  const answerTask = vi.fn(async () => {})
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] }, { answerTask })} />)
  const input = within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) })
  fireEvent.change(input, { target: { value: '抽屉' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(within(tray()).getByText(tr('askReplied', { text: '抽屉' }))).toBeTruthy()
  expect(within(tray()).getByRole('button', { name: tr('askUndo', { n: UNDO_SECONDS }) })).toBeTruthy()
  expect(answerTask).not.toHaveBeenCalled()
  await act(async () => { vi.advanceTimersByTime(UNDO_SECONDS * 1000) })
  expect(answerTask).toHaveBeenCalledWith(7, '抽屉')
  expect(within(tray()).queryByRole('button', { name: /撤回/ })).toBeNull()
  expect(within(tray()).getByText(tr('askReplied', { text: '抽屉' }))).toBeTruthy()
})

it('takes the reply back within the undo window and never sends it', async () => {
  vi.useFakeTimers()
  const answerTask = vi.fn(async () => {})
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] }, { answerTask })} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  fireEvent.click(within(tray()).getByRole('button', { name: zh.askSend }))
  await act(async () => { vi.advanceTimersByTime(2000) })
  fireEvent.click(within(tray()).getByRole('button', { name: tr('askUndo', { n: UNDO_SECONDS - 2 }) }))
  await act(async () => { vi.advanceTimersByTime(UNDO_SECONDS * 1000) })
  expect(answerTask).not.toHaveBeenCalled()
  expect((within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }) as HTMLInputElement).value).toBe('抽屉')
})

it('puts the text back with the error when the reply fails', async () => {
  vi.useFakeTimers()
  const answerTask = vi.fn(async () => { throw new Error('HTTP 409') })
  render(<ChannelsPage {...props({ ...base, tasks: [task(7)] }, { answerTask })} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '抽屉' } })
  fireEvent.click(within(tray()).getByRole('button', { name: zh.askSend }))
  await act(async () => { vi.advanceTimersByTime(UNDO_SECONDS * 1000) })
  expect(within(tray()).getByRole('alert').textContent).toBe('HTTP 409')
  expect((within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }) as HTMLInputElement).value).toBe('抽屉')
})

it('forgets a draft once its task leaves asked, so a question asked again starts empty', () => {
  const view = render(<ChannelsPage {...props({ ...base, tasks: [task(7)] })} />)
  fireEvent.change(within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }), { target: { value: '旧草稿' } })
  view.rerender(<ChannelsPage {...props({ ...base, tasks: [task(7, { status: 'accepted' })] })} />)
  expect(screen.queryByRole('region', { name: zh.decideTray })).toBeNull()
  view.rerender(<ChannelsPage {...props({ ...base, tasks: [task(7, { updated_at: 20 })] })} />)
  expect((within(tray()).getByRole('textbox', { name: tr('askReplyTo', { id: 7 }) }) as HTMLInputElement).value).toBe('')
})
