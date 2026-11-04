// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelMessage, ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); localStorage.clear() })
const message: ChannelMessage = { id: 1, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '有用的回复', card: null, created_at: 1, from_turn: null }
const state: ChannelSnapshot = { phase: 'ready', error: undefined, roomId: 1, rooms: [{ id: 1, name: 'general' }], members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], messages: [], thinking: {}, leadId: 'ju', effectiveLeadId: 'ju' }
function show(card: Record<string, unknown>) {
  const progress = { ...message, id: 2, text: '第 0 步 · 8秒', card: JSON.stringify(card) }
  return render(<ChannelsPage {...{ useChannels: (select: (s: ChannelSnapshot) => unknown) => select({ ...state, messages: [progress, { ...message, id: 3 }] }), selectRoom: vi.fn(), send: vi.fn(), openModelSettings: () => false, t: (key: keyof typeof zh) => zh[key] } as unknown as ChannelsPageProps} />)
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
