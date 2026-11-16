// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, runFailures, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelMessage, ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); localStorage.clear() })
const message: ChannelMessage = { id: 1, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '有用的回复', card: null, created_at: 1, from_turn: null }
const state: ChannelSnapshot = { phase: 'ready', error: undefined, roomId: 1, rooms: [{ id: 1, name: 'general' }], members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], messages: [], thinking: {}, leadId: 'ju', effectiveLeadId: 'ju' }
function props(get: () => ChannelSnapshot): ChannelsPageProps {
  return { useChannels: (select: (s: ChannelSnapshot) => unknown) => select(get()), selectRoom: vi.fn(), send: vi.fn(), loadOlder: vi.fn(async () => 0), openModelSettings: () => false, t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])) } as unknown as ChannelsPageProps
}
function show(card: Record<string, unknown>) {
  const progress = { ...message, id: 2, text: '第 0 步 · 8秒', card: JSON.stringify(card) }
  return render(<ChannelsPage {...props(() => ({ ...state, messages: [progress, { ...message, id: 3 }] }))} />)
}

it.each([0, 1])('hides a completed %i-step progress row and keeps the reply with its avatar', steps => {
  const view = show({ state: 'completed', steps, brief: '第 0 步 · 8秒' })
  expect(view.container.querySelector('[data-message-id="2"]')).toBeNull()
  expect(screen.getByText('有用的回复')).toBeTruthy()
  expect(view.container.querySelector('[data-message-id="3"] [aria-haspopup="menu"]')).toBeTruthy()
})

it.each([
  { state: 'completed', steps: 2 },
  { state: 'running', steps: 0 },
  { state: 'failed', steps: 1 },
  { state: 'cancelled', steps: 0 },
  { kind: 'permission', state: 'pending', steps: 0, actions: [] },
  { kind: 'task', state: 'completed', steps: 0 },
  { state: 'completed' },
  { state: 'completed', steps: 1, chips: [{ tool: 'bash', state: 'failed' }] },
  { state: 'completed', steps: 1, brief: '第 1 步 · 8秒\n❌ bash · 失败' },
])('keeps a meaningful or unknown progress card: %j', card => {
  const view = show(card)
  expect(view.container.querySelector('[data-message-id="2"]')).toBeTruthy()
})

it.each([{ steps: 0, delayedReply: false }, { steps: 1, delayedReply: true }])('keeps visible unread position when progress completes: %j', ({ steps, delayedReply }) => {
  let snapshot = { ...state, messages: [message] }
  const p = props(() => snapshot)
  const view = render(<ChannelsPage {...p} />)
  const log = screen.getByRole('log')
  // Geometry follows chat-motion.client.spec.tsx; simulate reading older rows.
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 })
  log.scrollTop = 200
  fireEvent.scroll(log)
  const running = { ...message, id: 2, card: JSON.stringify({ state: 'running', steps }) }
  snapshot = { ...snapshot, messages: [message, running] }
  view.rerender(<ChannelsPage {...p} />)
  expect(screen.getByText(zh.newMessagesDivider)).toBeTruthy()
  const completed = { ...running, card: JSON.stringify({ state: 'completed', steps }) }
  if (delayedReply) {
    snapshot = { ...snapshot, messages: [message, completed] }
    view.rerender(<ChannelsPage {...p} />)
    expect(screen.queryByText(zh.newMessagesDivider)).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(zh.jumpLatest) }).textContent).not.toContain(zh.jumpLatestCount.replace('{count}', '1'))
  }
  snapshot = { ...snapshot, messages: [message, completed, { ...message, id: 3 }] }
  view.rerender(<ChannelsPage {...p} />)
  expect(view.container.querySelector('[data-message-id="2"]')).toBeNull()
  expect(screen.getByText(zh.newMessagesDivider).nextElementSibling?.getAttribute('data-message-id')).toBe('3')
  expect(screen.getByRole('button', { name: new RegExp(zh.jumpLatest) }).textContent).toContain(zh.jumpLatestCount.replace('{count}', '1'))
})

it('keeps raw history available for paging when every loaded row is hidden', async () => {
  const snapshot = { ...state, hasMoreOlder: true, messages: [{ ...message, card: JSON.stringify({ state: 'completed', steps: 0 }) }] }
  const p = props(() => snapshot)
  render(<ChannelsPage {...p} />)
  const log = screen.getByRole('log')
  expect(log.querySelectorAll('[data-message-id]')).toHaveLength(0)
  await act(async () => { fireEvent.scroll(log) })
  expect(p.loadOlder).toHaveBeenCalledTimes(1)
  expect(snapshot.messages).toHaveLength(1)
})

// #1884: the run strip is the turn's first row; the failed step is named again under the turn's newest reply.
const failedRun = (id: number, at: number, over: Record<string, unknown> = {}): ChannelMessage => ({ ...message, id, created_at: at, text: '第 19 步 · 4分16秒',
  card: JSON.stringify({ state: 'completed', steps: 19, elapsed_sec: 256, chips: [{ tool: 'bash', state: 'ok' }, { tool: 'subagent', state: 'failed', input: '独立复核网关安全与存档', output: 'SubagentError\n  at run' }], ...over }) })

it('repeats a finished run\'s failed step under the newest reply of that run', () => {
  const messages = [failedRun(2, 100), { ...message, id: 3, created_at: 200, text: '先做了第一段' }, { ...message, id: 4, created_at: 350, text: '都做完了' }]
  const view = render(<ChannelsPage {...props(() => ({ ...state, messages }))} />)
  const note = view.container.querySelector('[data-message-id="4"] button[title="' + zh.runFailedOpen + '"]')
  expect(note?.textContent).toBe('这一轮有 1 步出错：subagent 独立复核网关安全与存档 — SubagentError')
  expect(view.container.querySelector('[data-message-id="3"] button[title="' + zh.runFailedOpen + '"]')).toBeNull()
  // the strip keeps its own label; the note leads to it
  expect(view.container.querySelector('[data-message-id="2"]')?.textContent).toContain(zh.runFailedSteps.replace('{count}', '1'))
  fireEvent.click(note!)
  expect(view.container.querySelector('[data-message-id="2"]')?.className).toMatch(/focused/)
})

it('names a failed step whose call is JSON by its kind alone', () => {
  const messages = [failedRun(2, 100, { chips: [{ tool: 'read_image', state: 'failed', input: '{\n  "file_path": "/x.png"\n}', output: 'Error: cannot read' }] }), { ...message, id: 3, created_at: 200 }]
  const view = render(<ChannelsPage {...props(() => ({ ...state, messages }))} />)
  expect(view.container.querySelector('[data-message-id="3"] button[title="' + zh.runFailedOpen + '"]')?.textContent).toBe('这一轮有 1 步出错：read_image — Error: cannot read')
})

it('leaves later turns, running runs and clean runs without the note', () => {
  const reply = (id: number, at: number, over: Partial<ChannelMessage> = {}): ChannelMessage => ({ ...message, id, created_at: at, ...over })
  // a reply after the run ended (100 + 256) belongs to a later turn; a command answer (from_turn 0) is not a reply
  expect([...runFailures([failedRun(2, 100), reply(3, 300), reply(4, 320, { from_turn: 0 }), reply(5, 900)])]).toEqual([[3, expect.objectContaining({ cardId: 2 })]])
  expect(runFailures([failedRun(2, 100, { state: 'running' }), reply(3, 200)]).size).toBe(0)
  expect(runFailures([failedRun(2, 100, { chips: [{ tool: 'bash', state: 'ok' }] }), reply(3, 200)]).size).toBe(0)
  // the author's next run takes over; another member's replies are not this run's
  expect([...runFailures([failedRun(2, 100), reply(3, 150), reply(4, 160, { author: 'yu' }), failedRun(5, 170, { chips: [{ tool: 'bash', state: 'ok' }] }), reply(6, 180)]).keys()]).toEqual([3])
})
