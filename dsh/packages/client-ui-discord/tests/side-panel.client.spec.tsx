// @vitest-environment jsdom
// #125: on wide screens the task board sits beside the chat (no backdrop, chat stays usable);
// narrower screens keep the overlay drawer.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import type { ChannelSnapshot, ChannelTask } from '../src/client/channel-source.ts'
import { zh } from '../src/client/locales.ts'

let wide = true
beforeEach(() => {
  wide = true
  vi.stubGlobal('matchMedia', (media: string) => ({
    media, matches: media === '(min-width: 1101px)' ? wide : false,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const tr = (key: keyof typeof zh, values?: Record<string, unknown>): string => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))
const task = (id: number, over: Partial<ChannelTask> = {}): ChannelTask => ({
  id, room_id: 2, parent_task: null, title: `任务${id}`, owner: 'ju', owner_name: '橘', created_by: 'me', created_by_name: '我',
  status: 'accepted', next_check_at: null, assign_msg_id: 50, result_msg_id: null, note: null, created_at: 1, updated_at: id, returned_at: null, ...over,
})
const base: ChannelSnapshot = {
  phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }, { id: 2, name: '工作区1', kind: 'workspace', parent_id: 1 }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {}, leadId: 'ju', effectiveLeadId: 'ju', messages: [], tasks: [task(7)], taskChat: 1,
}
function props(state: ChannelSnapshot, over: Partial<ChannelsPageProps> = {}): ChannelsPageProps {
  return {
    useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state),
    selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, decidePermission: vi.fn(async () => {}), retryMessage: vi.fn(async () => {}),
    t: tr, ...over,
  } as unknown as ChannelsPageProps
}
const open = () => { fireEvent.click(screen.getByRole('button', { name: zh.taskBoardOpen })) }
const title = new RegExp(`^${zh.taskBoard} · general$`)

it('opens the board beside the chat on wide screens: a page column, no modal, no backdrop', () => {
  const view = render(<ChannelsPage {...props(base)} />)
  open()
  const panel = screen.getByRole('region', { name: title })
  expect(screen.queryByRole('dialog')).toBeNull()
  const page = view.container.firstElementChild as HTMLElement
  expect(panel.parentElement?.parentElement).toBe(page)
  expect(page.className).toMatch(/panelOpen/)
  expect(document.body.querySelector('[class*="boardDrawerBackdrop"]')).toBeNull()
  expect(within(panel).getByText('#7 任务7')).toBeTruthy()
  // The chat stays usable while the panel is open.
  const box = screen.getByRole('combobox') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: '还在打字' } })
  expect(box.value).toBe('还在打字')
  expect(screen.getByRole('region', { name: title })).toBeTruthy()
})

it('closes the side panel with ×, Escape, or the board button again, and frees the column', () => {
  const view = render(<ChannelsPage {...props(base)} />)
  const page = view.container.firstElementChild as HTMLElement
  open()
  fireEvent.click(screen.getByRole('button', { name: zh.taskBoardClose }))
  expect(screen.queryByRole('region', { name: title })).toBeNull()
  expect(page.className).not.toMatch(/panelOpen/)
  open()
  fireEvent.keyDown(screen.getByRole('region', { name: title }), { key: 'Escape' })
  expect(screen.queryByRole('region', { name: title })).toBeNull()
  open()
  open()
  expect(screen.queryByRole('region', { name: title })).toBeNull()
})

it('keeps the side panel open when jumping to a task message in a workspace', () => {
  const selectRoom = vi.fn()
  render(<ChannelsPage {...props(base, { selectRoom })} />)
  open()
  fireEvent.click(within(screen.getByRole('region', { name: title })).getByRole('button', { name: zh.taskOpenAssign }))
  expect(selectRoom).toHaveBeenCalledWith(2)
  expect(screen.getByRole('region', { name: title })).toBeTruthy()
})

it('keeps the overlay drawer on narrower screens', () => {
  wide = false
  const view = render(<ChannelsPage {...props(base)} />)
  open()
  expect(screen.getByRole('dialog', { name: title })).toBeTruthy()
  expect((view.container.firstElementChild as HTMLElement).className).not.toMatch(/panelOpen/)
})
