// @vitest-environment jsdom
// #125: the channels page is white by default whatever the DSH host/system theme says;
// a manual switch is remembered in the plugin's own storage and never touches the host.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChannelsPage, type ChannelsPageProps } from '../src/client/ChannelsPage.tsx'
import { TaskBoard } from '../src/client/TaskBoard.tsx'
import type { ChannelSnapshot, ChannelTask } from '../src/client/channel-source.ts'
import type { T } from '../src/client/task-board.ts'
import { zh } from '../src/client/locales.ts'
import css from '../src/client/ChannelsPage.module.css'
import { SCHEME_KEY, resetSchemeCache, setScheme } from '../src/client/scheme.ts'

const state: ChannelSnapshot = {
  phase: 'ready', error: undefined, rooms: [{ id: 1, name: 'general', kind: 'chat' }], roomId: 1,
  members: [{ id: 'ju', name: '橘', kind: 'bot', online: true }], thinking: {}, leadId: 'ju', effectiveLeadId: 'ju', messages: [],
}
const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), String(zh[key]))) as T
const props = { useChannels: (select: (s: ChannelSnapshot) => unknown) => select(state), selectRoom: vi.fn(), send: vi.fn(async () => {}), openModelSettings: () => false, t } as unknown as ChannelsPageProps
const page = (container: HTMLElement) => container.querySelector('[data-dc-scheme]') as HTMLElement

// Some Node/jsdom pairs expose no usable localStorage; a Map-backed stand-in keeps the test about the plugin.
const store = new Map<string, string>()
const memoryStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)) }, removeItem: (k: string) => { store.delete(k) }, clear: () => { store.clear() } }
beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage); store.clear(); resetSchemeCache() })
afterEach(() => { cleanup(); document.body.removeAttribute('data-ds-dark-theme'); store.clear(); resetSchemeCache(); vi.unstubAllGlobals() })

it('opens white even when the host body is in its dark palette', () => {
  document.body.setAttribute('data-ds-dark-theme', '')
  const { container } = render(<ChannelsPage {...props} />)
  expect(page(container).getAttribute('data-dc-scheme')).toBe('light')
})

it('switches to dark from the header, remembers it in plugin storage, and leaves the host theme alone', () => {
  const { container, unmount } = render(<ChannelsPage {...props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.schemeToDark }))
  expect(page(container).getAttribute('data-dc-scheme')).toBe('dark')
  expect(localStorage.getItem(SCHEME_KEY)).toBe('dark')
  expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
  unmount(); resetSchemeCache()
  const again = render(<ChannelsPage {...props} />)
  expect(page(again.container).getAttribute('data-dc-scheme')).toBe('dark')
  fireEvent.click(screen.getByRole('button', { name: zh.schemeToLight }))
  expect(page(again.container).getAttribute('data-dc-scheme')).toBe('light')
  expect(localStorage.getItem(SCHEME_KEY)).toBe('light')
})

it('ignores a garbage stored value and falls back to white', () => {
  localStorage.setItem(SCHEME_KEY, 'system')
  const { container } = render(<ChannelsPage {...props} />)
  expect(page(container).getAttribute('data-dc-scheme')).toBe('light')
})

it('carries the plugin scheme onto the task board dialog it portals into the body', () => {
  act(() => { setScheme('dark') })
  const task: ChannelTask = { id: 1, room_id: 1, parent_task: null, title: 'T', owner: 'a', owner_name: 'A', created_by: 'a', created_by_name: 'A', status: 'accepted', next_check_at: null, assign_msg_id: 5, result_msg_id: 6, note: null, created_at: 1, updated_at: 2, returned_at: null }
  render(<TaskBoard tasks={[task]} rooms={state.rooms} chatId={1} roomId={1} t={t} onOpen={vi.fn()} />)
  fireEvent.click(screen.getAllByRole('button')[0]!)
  const backdrop = screen.getByRole('dialog').closest('[data-dc-scheme]')
  expect(backdrop?.getAttribute('data-dc-scheme')).toBe('dark')
  expect(backdrop?.parentElement).toBe(document.body)
})

it('keeps the theme switch out of the panel-toggle class that narrow windows hide', () => {
  // ChannelsPage.module.css hides .panelToggle at max-width 900px (drawers take over there);
  // the theme switch must stay on phones, so it has its own class only.
  render(<ChannelsPage {...props} />)
  const button = screen.getByRole('button', { name: zh.schemeToDark })
  expect(button.classList.contains(css.schemeToggle)).toBe(true)
  expect(button.classList.contains(css.panelToggle)).toBe(false)
})
