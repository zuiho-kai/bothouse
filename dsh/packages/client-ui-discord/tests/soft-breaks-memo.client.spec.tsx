// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelSnapshot } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'
import { softBreaksToHard } from '../src/client/softBreaks.ts'

// Count parses: every composer keystroke re-renders each MessageRow, and parsing
// each message again on every key makes typing lag on phones.
vi.mock('../src/client/softBreaks.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/softBreaks.ts')>()
  return { ...actual, softBreaksToHard: vi.fn(actual.softBreaksToHard) }
})

afterEach(cleanup)

const state: ChannelSnapshot = {
  phase: 'ready', error: undefined,
  rooms: [{ id: 1, name: 'general' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {},
  leadId: 'ju', effectiveLeadId: 'ju',
  messages: [
    { id: 1, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '第一行\n第二行', created_at: 1, card: null, from_turn: null },
    { id: 2, room_id: 1, author_kind: 'role', author: 'ju', name: '橘', text: '详细\n内容', created_at: 2, card: JSON.stringify({ title: '卡', brief: '简略\n内容' }), from_turn: null },
  ],
}

function props(): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: async () => {}, openModelSettings: () => false,
    createRoom: vi.fn(async () => {}), listModels: vi.fn(async () => []),
    addMember: vi.fn(async () => {}), updateMember: vi.fn(async () => {}), removeMember: vi.fn(async () => {}),
    setLead: vi.fn(async () => {}), setDispatchMode: vi.fn(async () => {}),
    t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
      .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key])),
  } as unknown as ChannelsPageProps
}

it('does not re-parse messages for soft breaks while typing in the composer', () => {
  const parse = vi.mocked(softBreaksToHard)
  render(<ChannelsPage {...props()} />)
  const afterMount = parse.mock.calls.length
  expect(afterMount).toBeGreaterThanOrEqual(2)
  const input = screen.getByRole('combobox')
  for (const value of ['你', '你好', '你好呀', '你好呀橘']) fireEvent.change(input, { target: { value } })
  expect((input as HTMLTextAreaElement).value).toBe('你好呀橘')
  expect(parse.mock.calls.length).toBe(afterMount)
})
